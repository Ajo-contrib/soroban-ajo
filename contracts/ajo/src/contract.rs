use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};

use crate::errors::AjoError;
use crate::events;
use crate::pausable;
use crate::storage;
use crate::types::{
    AchievementRecord, Group, GroupAccessType, GroupMetadata, GroupStatus, MemberStats,
    MilestoneRecord, PayoutOrderingStrategy,
};
use crate::utils;

/// The main Ajo contract
#[contract]
pub struct AjoContract;

#[contractimpl]
impl AjoContract {
    /// Initialize the contract with an admin.
    ///
    /// This function must be called exactly once to set up the contract's admin.
    /// After initialization, the admin can upgrade the contract.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `admin` - Address of the contract administrator
    ///
    /// # Returns
    /// `Ok(())` on successful initialization
    ///
    /// # Errors
    /// * `AlreadyInitialized` - If the contract has already been initialized
    pub fn initialize(env: Env, admin: Address) -> Result<(), AjoError> {
        if storage::get_admin(&env).is_some() {
            return Err(AjoError::AlreadyInitialized);
        }
        storage::store_admin(&env, &admin);
        Ok(())
    }

    /// Upgrade the contract's Wasm bytecode.
    ///
    /// Only the admin can call this function. The contract will be updated to the
    /// new Wasm code specified by `new_wasm_hash`.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `caller` - Address invoking the upgrade; must be the contract admin
    /// * `new_wasm_hash` - The hash of the new Wasm code (32 bytes)
    ///
    /// # Returns
    /// `Ok(())` on successful upgrade
    ///
    /// # Errors
    /// * `Unauthorized` - If the caller is not the admin
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>, schema_version: u32) -> Result<(), AjoError> {
        let admin = storage::get_admin(&env).ok_or(AjoError::Unauthorized)?;
        if caller != admin {
            return Err(AjoError::Unauthorized);
        }
        caller.require_auth();
        storage::ensure_supported_schema(&env)?;

        // This release intentionally fails closed for non-additive storage-shape
        // changes. A future Wasm that changes persisted structs must expose and
        // test an explicit vN->vN+1 migration before this check can be advanced.
        if schema_version != storage::CURRENT_SCHEMA_VERSION {
            return Err(AjoError::SchemaMismatch);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Return the persisted storage schema version understood by this Wasm.
    pub fn storage_schema_version(env: Env) -> u32 {
        storage::get_schema_version(&env)
    }

    /// Pause the contract to prevent state-mutating operations.
    ///
    /// This emergency function allows the admin to temporarily halt all state-mutating
    /// operations (create_group, join_group, contribute, execute_payout) while keeping
    /// query functions and admin functions operational. This is useful during security
    /// incidents, detected vulnerabilities, or maintenance periods.
    ///
    /// When paused:
    /// - All state-mutating operations will fail with `ContractPaused` error
    /// - Query operations continue to work normally
    /// - Admin operations (pause, unpause, upgrade) remain available
    /// - All stored data (groups, contributions, payouts) remains safe and intact
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `caller` - Address invoking the pause; must be the contract admin
    ///
    /// # Returns
    /// `Ok(())` on successful pause
    ///
    /// # Errors
    /// * `Unauthorized` - If the caller is not the admin
    ///
    /// # Authorization
    /// Only the contract admin can call this function.
    pub fn pause(env: Env, caller: Address) -> Result<(), AjoError> {
        pausable::pause(&env, &caller)
    }

    /// Unpause the contract to restore normal operations.
    ///
    /// This function allows the admin to restore full contract functionality after
    /// an emergency pause. Once unpaused, all state-mutating operations return to
    /// normal operation. All data remains intact and accessible.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `caller` - Address invoking the unpause; must be the contract admin
    ///
    /// # Returns
    /// `Ok(())` on successful unpause
    ///
    /// # Errors
    /// * `Unauthorized` - If the caller is not the admin
    ///
    /// # Authorization
    /// Only the contract admin can call this function.
    ///
    /// # Data Safety
    /// Unpausing does not modify any stored data. All groups, contributions, and
    /// payouts remain exactly as they were before the pause.
    pub fn unpause(env: Env, caller: Address) -> Result<(), AjoError> {
        pausable::unpause(&env, &caller)
    }

    /// Create a new Ajo group.
    ///
    /// Initializes a new rotating savings group with the specified parameters.
    /// The creator becomes the first member and the contract validates all parameters
    /// before storage. A unique group ID is assigned and returned.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `creator` - Address of the group creator (automatically becomes first member)
    /// * `token_address` - Address of the token contract (SAC) for contributions and payouts
    /// * `contribution_amount` - Fixed amount each member contributes per cycle (in token units, must be > 0)
    /// * `cycle_duration` - Duration of each cycle in seconds (must be > 0)
    /// * `max_members` - Maximum number of members allowed in the group (must be >= 2 and <= 100)
    /// * `grace_period` - Grace period duration in seconds after cycle ends (default: 86400 = 24 hours)
    /// * `penalty_rate` - Penalty rate as percentage for late contributions (0-100, default: 5)
    ///
    /// # Returns
    /// The unique group ID assigned to the new group
    ///
    /// # Errors
    /// * `ContributionAmountZero` - If contribution_amount == 0
    /// * `ContributionAmountNegative` - If contribution_amount < 0
    /// * `CycleDurationZero` - If cycle_duration == 0
    /// * `MaxMembersBelowMinimum` - If max_members < 2
    /// * `MaxMembersAboveLimit` - If max_members > 100
    /// * `InvalidGracePeriod` - If grace_period > 7 days
    /// * `InvalidPenaltyRate` - If penalty_rate > 100
    pub fn create_group(
        env: Env,
        creator: Address,
        token_address: Address,
        contribution_amount: i128,
        cycle_duration: u64,
        max_members: u32,
        grace_period: u64,
        penalty_rate: u32,
        insurance_rate_bps: u32,
    ) -> Result<u64, AjoError> {
        // Validate parameters
        utils::validate_group_params(contribution_amount, cycle_duration, max_members)?;
        utils::validate_penalty_params(grace_period, penalty_rate)?;

        // Check if paused
        pausable::ensure_not_paused(&env)?;

        // Require authentication
        creator.require_auth();

        // Generate new group ID
        let group_id = storage::get_next_group_id(&env);

        // Initialize members list with creator
        let mut members = Vec::new(&env);
        members.push_back(creator.clone());

        // Get current timestamp
        let now = utils::get_current_timestamp(&env);

        // Create group
        let group = Group {
            id: group_id,
            creator: creator.clone(),
            token_address,
            contribution_amount,
            cycle_duration,
            max_members,
            members,
            current_cycle: 1,
            payout_index: 0,
            created_at: now,
            cycle_start_time: now,
            is_complete: false,
            grace_period,
            penalty_rate,
            state: crate::types::GroupState::Active,
            insurance_config: crate::types::InsuranceConfig {
                rate_bps: insurance_rate_bps,
                is_enabled: insurance_rate_bps > 0,
            },
            payout_strategy: PayoutOrderingStrategy::Sequential,
            access_type: crate::types::GroupAccessType::Open,
        };

        // Store group
        storage::store_group(&env, group_id, &group);

        // Emit event
        events::emit_group_created(&env, group_id, &creator, contribution_amount, max_members);

        Ok(group_id)
    }

    /// Get group information.
    ///
    /// Retrieves the complete group data including all members, cycle information,
    /// and metadata.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// The group data containing group configuration and current state
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    pub fn get_group(env: Env, group_id: u64) -> Result<Group, AjoError> {
        storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)
    }

    /// Get list of all members in a group.
    ///
    /// Returns the ordered list of all member addresses currently in the group.
    /// Members are ordered by join time, with the creator being the first member.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// Vector of member addresses in join order
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    pub fn list_members(env: Env, group_id: u64) -> Result<Vec<Address>, AjoError> {
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        Ok(group.members)
    }

    /// Join an existing group.
    ///
    /// Adds a new member to an active group if space is available.
    /// The member's authentication is required. The member cannot join if they
    /// are already a member, the group is full, or the group has completed all cycles.
    /// For InviteOnly groups, requires a valid, non-expired invitation.
    /// For ApprovalRequired groups, direct joining is not allowed.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `member` - Address of the member joining (must authenticate)
    /// * `group_id` - The group to join
    ///
    /// # Returns
    /// `Ok(())` on successful group join
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    /// * `MaxMembersExceeded` - If the group has reached max members
    /// * `AlreadyMember` - If the address is already a member
    /// * `GroupComplete` - If the group has completed all cycles
    /// * `GroupAccessRestricted` - If the group is invite-only or approval-required
    /// * `InvitationExpired` - If the invitation has expired
    /// * `InvitationAlreadyAccepted` - If the invitation was already used
    pub fn join_group(env: Env, member: Address, group_id: u64) -> Result<(), AjoError> {
        // Check if paused
        pausable::ensure_not_paused(&env)?;

        // Require authentication
        member.require_auth();

        // Get group
        let mut group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Cache member count for comparisons
        let member_count = group.members.len() as u32;
        let max_members = group.max_members;

        // Check if group is complete
        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }

        // Check if group is cancelled
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }

        // Check if already a member
        if utils::is_member(&group.members, &member) {
            return Err(AjoError::AlreadyMember);
        }

        // Check if group is full
        if member_count >= max_members {
            return Err(AjoError::MaxMembersExceeded);
        }

        // Check access type
        match group.access_type {
            GroupAccessType::Open => {
                // Open groups allow direct joining
            }
            GroupAccessType::InviteOnly => {
                // Check for valid invitation
                let invitation = storage::get_invitation(&env, group_id, &member)
                    .ok_or(AjoError::Unauthorized)?;

                // Check if invitation is expired
                let now = utils::get_current_timestamp(&env);
                if now > invitation.expires_at {
                    return Err(AjoError::OutsideCycleWindow);
                }

                // Check if already accepted
                if invitation.accepted {
                    return Err(AjoError::AlreadyMember);
                }
            }
            GroupAccessType::ApprovalRequired => {
                // Direct joining is not allowed for approval-required groups
                return Err(AjoError::Unauthorized);
            }
        }

        // Add member
        group.members.push_back(member.clone());

        // Update storage
        storage::store_group(&env, group_id, &group);

        // Emit event
        events::emit_member_joined(&env, group_id, &member);

        // Update member stats
        let mut stats = storage::get_member_stats(&env, &member)
            .unwrap_or_else(|| utils::default_member_stats(&env, &member));
        stats.total_groups_joined += 1;
        storage::store_member_stats(&env, &member, &stats);

        Ok(())
    }

    /// Check if an address is a member of a group.
    ///
    /// Returns whether the provided address is currently a member of the specified group.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The group to check
    /// * `address` - The address to check
    ///
    /// # Returns
    /// `true` if the address is a member, `false` otherwise
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    pub fn is_member(env: Env, group_id: u64, address: Address) -> Result<bool, AjoError> {
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        Ok(utils::is_member(&group.members, &address))
    }

    /// Contribute to the current cycle.
    ///
    /// Records a member's contribution for the current cycle and transfers tokens from
    /// the member to the contract. Each member can contribute once per cycle.
    /// Authentication is required.
    ///
    /// The function transfers the contribution amount from the member's token balance
    /// to the contract. Late contributions (after cycle ends but within grace period)
    /// incur penalties. Contributions after grace period are rejected.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `member` - Address making the contribution (must authenticate)
    /// * `group_id` - The group to contribute to
    ///
    /// # Returns
    /// `Ok(())` on successful contribution and token transfer
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    /// * `NotMember` - If the address is not a member
    /// * `AlreadyContributed` - If already contributed this cycle
    /// * `GroupComplete` - If the group has completed all cycles
    /// * `GracePeriodExpired` - If contribution is too late (after grace period)
    /// * `InsufficientBalance` - If member doesn't have enough tokens
    /// * `InsufficientBalance` - If the token transfer fails
    pub fn contribute(env: Env, member: Address, group_id: u64) -> Result<(), AjoError> {
        // Check if paused
        pausable::ensure_not_paused(&env)?;

        // Require authentication
        member.require_auth();

        // Get group (single fetch)
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Cache frequently accessed values
        let group_id_cached = group.id;
        let current_cycle = group.current_cycle;
        let contribution_amount = group.contribution_amount;

        // Check if group is complete
        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }

        // Check if group is cancelled
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }

        // Check if member
        if !utils::is_member(&group.members, &member) {
            return Err(AjoError::NotMember);
        }

        // Check if already contributed
        if storage::has_contributed(&env, group_id_cached, current_cycle, &member) {
            return Err(AjoError::AlreadyContributed);
        }

        // Check timing: reject once the grace period has fully elapsed, and
        // flag anything after the cycle end (but still within grace) as late.
        let now = utils::get_current_timestamp(&env);
        let cycle_end = group.cycle_start_time + group.cycle_duration;
        let grace_end = utils::get_grace_period_end(&group);
        if now > grace_end {
            return Err(AjoError::GracePeriodExpired);
        }
        let is_late = now > cycle_end;

        // A late contribution owes a penalty surcharge on top of the base
        // amount - this is the money `execute_payout` later adds to the
        // recipient's payout as the cycle's penalty bonus, so it must
        // actually be collected here rather than carved out of the base
        // contribution the group already needs in full.
        let penalty_amount = if is_late {
            contribution_amount * (group.penalty_rate as i128) / 100
        } else {
            0
        };
        let amount_due = contribution_amount + penalty_amount;

        // Get contract address for token transfer
        let contract_address = env.current_contract_address();

        // Check member balance before transfer
        crate::token::check_balance(&env, &group.token_address, &member, amount_due)?;

        // Transfer tokens from member to contract
        crate::token::transfer_token(
            &env,
            &group.token_address,
            &member,
            &contract_address,
            amount_due,
        )?;

        // Record contribution
        storage::store_contribution(&env, group_id_cached, current_cycle, &member, true);

        storage::store_contribution_detail(
            &env,
            group_id_cached,
            current_cycle,
            &member,
            &crate::types::ContributionRecord {
                group_id: group_id_cached,
                cycle: current_cycle,
                member: member.clone(),
                amount: contribution_amount,
                timestamp: now,
                is_late,
                penalty_amount,
            },
        );

        let mut penalty_record = storage::get_member_penalty(&env, group_id_cached, &member)
            .unwrap_or(crate::types::MemberPenaltyRecord {
                member: member.clone(),
                group_id: group_id_cached,
                late_count: 0,
                on_time_count: 0,
                total_penalties: 0,
                reliability_score: 100,
            });
        if is_late {
            penalty_record.late_count += 1;
            penalty_record.total_penalties += penalty_amount;
            storage::add_to_penalty_pool(&env, group_id_cached, current_cycle, penalty_amount);
        } else {
            penalty_record.on_time_count += 1;
        }
        let total_tracked = penalty_record.on_time_count + penalty_record.late_count;
        penalty_record.reliability_score = if total_tracked > 0 {
            penalty_record.on_time_count * 100 / total_tracked
        } else {
            100
        };
        storage::store_member_penalty(&env, group_id_cached, &member, &penalty_record);

        // Insurance logic: Deduct premium if enabled
        if group.insurance_config.is_enabled {
            let premium = crate::insurance::calculate_premium(contribution_amount, group.insurance_config.rate_bps);
            if premium > 0 {
                crate::insurance::deposit_to_pool(&env, &group.token_address, premium);
            }
        }

        // Emit event
        events::emit_contribution_made(
            &env,
            group_id_cached,
            &member,
            current_cycle,
            contribution_amount,
        );

        // Update member stats
        let mut stats = storage::get_member_stats(&env, &member)
            .unwrap_or_else(|| utils::default_member_stats(&env, &member));
        stats.total_contributions += 1;
        stats.on_time_contributions += 1;
        stats.total_amount_contributed += contribution_amount;
        // Only count this contribution toward the credit score if the group
        // has real stake at risk per cycle (see reputation::MIN_REPUTATION_STAKE).
        if contribution_amount >= crate::reputation::MIN_REPUTATION_STAKE {
            stats.qualifying_contributions += 1;
            stats.qualifying_ontime_contribs += 1;
            stats.qualifying_amount_contributed += contribution_amount;
        }
        storage::store_member_stats(&env, &member, &stats);

        // Check and record member achievements
        let achievements = utils::check_member_achievements(&env, &member, &stats);
        for achievement in achievements.iter() {
            let record = AchievementRecord {
                member: member.clone(),
                achievement,
                earned_at: utils::get_current_timestamp(&env),
                group_id: group_id_cached,
            };
            storage::add_member_achievement(&env, &member, &record);
            events::emit_achievement_earned(&env, &member, record.achievement as u32, group_id_cached);
        }

        // Record payment history entry and update on-chain reputation
        crate::reputation::record_payment_event(
            &env,
            &member,
            group_id_cached,
            current_cycle,
            contribution_amount,
            false, // on-time contribution
            false,
        );
        let _ = crate::reputation::update_member_reputation(&env, &member);

        Ok(())
    }

    /// Get contribution status for all members in a specific cycle.
    ///
    /// Returns an ordered list of all members paired with their contribution status
    /// for the specified cycle. Member order matches the group's member list order.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The group to check
    /// * `cycle_number` - The cycle to check (typically use current_cycle from group)
    ///
    /// # Returns
    /// Vector of (Address, bool) tuples where `true` indicates the member has contributed
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    pub fn get_contribution_status(
        env: Env,
        group_id: u64,
        cycle_number: u32,
    ) -> Result<Vec<(Address, bool)>, AjoError> {
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        Ok(storage::get_cycle_contributions(
            &env,
            group_id,
            cycle_number,
            &group.members,
        ))
    }

    /// Execute payout for the current cycle.
    ///
    /// This is the core function that rotates payouts through group members.
    /// It verifies that all members have contributed, calculates the total payout
    /// (including any penalties collected), transfers tokens from the contract to
    /// the recipient, and advances the cycle. When all members have received their
    /// payout, the group is marked complete.
    ///
    /// Payout can only be executed after the grace period expires to ensure all
    /// late contributions are collected.
    ///
    /// Process:
    /// 1. Verifies all members have contributed in the current cycle
    /// 2. Ensures grace period has expired
    /// 3. Calculates total payout (contribution_amount × member_count + penalties)
    /// 4. Verifies contract has sufficient token balance
    /// 5. Transfers tokens from contract to recipient
    /// 6. Records payout to the current recipient
    /// 7. Emits payout event with penalty bonus
    /// 8. Advances to next cycle (or marks complete if done)
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The group to execute payout for
    ///
    /// # Returns
    /// `Ok(())` on successful payout execution and token transfer
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    /// * `IncompleteContributions` - If not all members have contributed
    /// * `GroupComplete` - If the group has already completed all payouts
    /// * `NoEligibleMembers` - If the group has no members (should never happen)
    /// * `OutsideCycleWindow` - If grace period has not expired yet
    /// * `InsufficientContractBalance` - If contract doesn't have enough tokens
    /// * `InsufficientBalance` - If the token transfer fails
    pub fn execute_payout(env: Env, group_id: u64) -> Result<(), AjoError> {
        // Check if paused
        pausable::ensure_not_paused(&env)?;

        // Get group (single fetch)
        let mut group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Check if group is cancelled
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }

        // Check if group is complete
        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }

        // Cache frequently accessed values
        let group_id_cached = group.id;
        let current_cycle = group.current_cycle;
        let member_count = group.members.len();

        // Check if all members have contributed
        if !utils::all_members_contributed(&env, &group) {
            return Err(AjoError::IncompleteContributions);
        }

        // Ensure grace period has expired before executing payout
        let current_time = utils::get_current_timestamp(&env);
        let grace_end = utils::get_grace_period_end(&group);
        if current_time < grace_end {
            // Still within grace period - delay payout
            return Err(AjoError::OutsideCycleWindow);
        }

        // Get payout recipient using the group's ordering strategy
        let payout_recipient = utils::determine_next_recipient(&env, &group)?;

        // Calculate payout amounts: base payout + collected penalties for this cycle
        let base_payout = group.contribution_amount * (member_count as i128);
        let penalty_bonus = storage::get_cycle_penalty_pool(&env, group_id_cached, current_cycle);
        let payout_amount = base_payout + penalty_bonus;

        // ═══════════════════════════════════════════════════════════════════════════
        // CHECKS-EFFECTS-INTERACTIONS (CEI) ORDERING - SECURITY CRITICAL
        // ═══════════════════════════════════════════════════════════════════════════
        // Per Issue #794 security audit: ALL internal state must be updated BEFORE
        // external calls (token transfers). This prevents reentrancy attacks where a
        // malicious token callback could observe partial state.
        //
        // Order:
        // 1. EFFECTS: Update all internal state
        // 2. INTERACTIONS: External calls (token transfers)

        // ─────────────────────────────────────────────────────────────────────────
        // EFFECTS PHASE: Update all internal state before external calls
        // ─────────────────────────────────────────────────────────────────────────

        // Mark payout as received in storage
        storage::mark_payout_received(&env, group_id_cached, &payout_recipient);

        // Advance payout index and update group state
        group.payout_index += 1;

        // Check if all members have received payout
        if group.payout_index >= member_count as u32 {
            // All members have received payout - mark complete
            group.is_complete = true;
        } else {
            // Advance to next cycle
            group.current_cycle += 1;
            group.cycle_start_time = utils::get_current_timestamp(&env);
        }

        // Update storage with new group state (single atomic write)
        storage::store_group(&env, group_id, &group);

        // Record payout receipt in payment history
        crate::reputation::record_payment_event(
            &env,
            &payout_recipient,
            group_id_cached,
            current_cycle,
            payout_amount,
            false,
            true, // is_payout
        );

        // Check and record group milestones
        let milestones = utils::check_group_milestones(&env, &group);
        for milestone in milestones.iter() {
            let record = MilestoneRecord {
                group_id: group.id,
                milestone,
                achieved_at: utils::get_current_timestamp(&env),
                cycle_number: current_cycle,
            };
            storage::add_group_milestone(&env, group.id, &record);
        }

        // If group completed, update member stats for all members
        if group.is_complete {
            let qualifies = group.contribution_amount >= crate::reputation::MIN_REPUTATION_STAKE;
            for member in group.members.iter() {
                let mut stats = storage::get_member_stats(&env, &member)
                    .unwrap_or_else(|| utils::default_member_stats(&env, &member));
                stats.total_groups_completed += 1;
                if qualifies {
                    stats.qualifying_groups_completed += 1;
                }
                storage::store_member_stats(&env, &member, &stats);
                // Update reputation for all members on group completion
                let _ = crate::reputation::update_member_reputation(&env, &member);
            }
        }

        // Update reputation for recipient
        let _ = crate::reputation::update_member_reputation(&env, &payout_recipient);

        // ─────────────────────────────────────────────────────────────────────────
        // INTERACTIONS PHASE: External calls (token transfers) happen LAST
        // ─────────────────────────────────────────────────────────────────────────

        // Get contract address for token transfer
        let contract_address = env.current_contract_address();

        // Verify contract has sufficient balance before external call
        crate::token::check_contract_balance(
            &env,
            &group.token_address,
            &contract_address,
            payout_amount,
        )?;

        // Transfer tokens from contract to recipient (EXTERNAL CALL - happens last)
        crate::token::transfer_token(
            &env,
            &group.token_address,
            &contract_address,
            &payout_recipient,
            payout_amount,
        )?;

        // ─────────────────────────────────────────────────────────────────────────
        // EVENTS: Emit events after state updates and external calls
        // ─────────────────────────────────────────────────────────────────────────

        // Emit payout event with penalty information
        if penalty_bonus > 0 {
            events::emit_penalty_distributed(
                &env,
                group_id,
                &payout_recipient,
                current_cycle,
                base_payout,
                penalty_bonus,
            );
        }

        events::emit_payout_executed(
            &env,
            group_id_cached,
            &payout_recipient,
            current_cycle,
            payout_amount,
        );

        // Record the ordering decision for transparency
        events::emit_payout_order_determined(
            &env,
            group_id_cached,
            current_cycle,
            &payout_recipient,
            group.payout_strategy as u32,
        );

        // Emit completion event if applicable
        if group.is_complete {
            events::emit_group_completed(&env, group_id_cached);
        }

        // Emit milestone events
        for milestone in milestones.iter() {
            events::emit_milestone_achieved(&env, group_id, milestone as u32, current_cycle);
        }

        Ok(())
    }
    // Insurance – automated claim verification & settlement

    /// Automatically verify and settle an insurance claim based on on-chain data.
    ///
    /// Replaces the manual admin-approval flow with fully automated, trustless
    
    pub fn auto_verify_insurance_claim(env: Env, claim_id: u64) -> Result<(), AjoError> {
        // Honour the global pause flag so this endpoint is blocked during emergencies.
        pausable::ensure_not_paused(&env)?;

        crate::insurance::auto_process_claim(&env, claim_id)
    }

    /// Get insurance pool information for a token.
    ///
    /// Returns the current balance, total payouts, and pending claims count
    /// for the insurance pool associated with the given token address.
    ///
    /// # Arguments
    /// * `env`           - The Soroban contract environment
    /// * `token_address` - Token contract address for the pool to query
    ///
    /// # Returns
    /// `Ok(InsurancePool)` containing pool balance and statistics.
    ///
    /// # Errors
    /// * `PoolNotFound` – no pool exists for the given token
    pub fn get_insurance_pool_info(
        env: Env,
        token_address: Address,
    ) -> Result<crate::types::InsurancePool, AjoError> {
        crate::insurance::get_pool_info(&env, &token_address)
    }

    // Query helpers
    
    pub fn is_complete(env: Env, group_id: u64) -> Result<bool, AjoError> {
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        Ok(group.is_complete)
    }

    /// Get comprehensive group status.
    ///
    /// Returns a detailed snapshot of the group's current state, including cycle
    /// information, contribution status, payout progress, and timing data.
    /// This is the primary function for checking a group's overall progress.
    ///
    /// Returns information about:
    /// - Current cycle number and progress
    /// - Next recipient for payout
    /// - Members who have contributed and those who are pending
    /// - Cycle timing (start time, end time, whether cycle is active)
    /// - Whether the group is complete
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// A `GroupStatus` struct containing comprehensive group state information
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    pub fn get_group_status(env: Env, group_id: u64) -> Result<GroupStatus, AjoError> {
        // Get the group data (single fetch)
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Cache frequently accessed values
        let current_time = utils::get_current_timestamp(&env);
        let _member_count = group.members.len();
        let group_id_cached = group.id;
        let current_cycle = group.current_cycle;

        // Calculate cycle timing
        let cycle_end_time = group.cycle_start_time + group.cycle_duration;
        let grace_period_end_time = utils::get_grace_period_end(&group);
        let is_cycle_active = current_time < cycle_end_time;
        let is_in_grace_period = utils::is_within_grace_period(&group, current_time);

        // Get penalty pool for current cycle
        let cycle_penalty_pool = storage::get_cycle_penalty_pool(&env, group_id, group.current_cycle);

        // Build pending_contributors list
        let mut contributions_received: u32 = 0;
        let mut pending_contributors = Vec::new(&env);

        // Single pass through members to check contributions
        for member in group.members.iter() {
            if storage::has_contributed(&env, group_id_cached, current_cycle, &member) {
                contributions_received += 1;
            } else {
                pending_contributors.push_back(member);
            }
        }

        // Determine next recipient according to the configured strategy without
        // committing payout-order storage from a read-only status query.
        let (has_next_recipient, next_recipient) = if group.is_complete {
            (false, group.creator.clone())
        } else {
            match utils::preview_next_recipient(&env, &group) {
                Ok(recipient) => (true, recipient),
                Err(_) => (false, group.creator.clone()),
            }
        };

        // Build and return status
        Ok(GroupStatus {
            group_id: group.id,
            current_cycle: group.current_cycle,
            has_next_recipient,
            next_recipient,
            contributions_received,
            total_members: group.members.len() as u32,
            pending_contributors,
            is_complete: group.is_complete,
            is_cycle_active,
            cycle_start_time: group.cycle_start_time,
            cycle_end_time,
            current_time,
            cycle_penalty_pool,
            is_in_grace_period,
            grace_period_end_time,
        })
    }

    /// Set or update metadata for an Ajo group.
    ///
    /// Only the group creator can set or update metadata.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `caller` - Address setting the metadata; must be the group creator
    /// * `group_id` - The unique group identifier
    /// * `name` - The name of the group
    /// * `description` - The description of the group
    /// * `rules` - The rules of the group
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    /// * `Unauthorized` - If the caller is not the group creator
    /// * `MetadataTooLong` - If any field exceeds its length limit
    pub fn set_group_metadata(
        env: Env,
        caller: Address,
        group_id: u64,
        name: soroban_sdk::String,
        description: soroban_sdk::String,
        rules: soroban_sdk::String,
    ) -> Result<(), AjoError> {
        // Validate lengths
        if name.len() > crate::types::MAX_NAME_LENGTH
            || description.len() > crate::types::MAX_DESCRIPTION_LENGTH
            || rules.len() > crate::types::MAX_RULES_LENGTH
        {
            return Err(AjoError::MetadataTooLong);
        }

        // Get group to verify existence and check creator
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Require creator authentication
        if caller != group.creator {
            return Err(AjoError::Unauthorized);
        }
        caller.require_auth();

        // Create and store metadata
        let metadata = GroupMetadata {
            name,
            description,
            rules,
        };
        storage::store_group_metadata(&env, group_id, &metadata);

        Ok(())
    }

    /// Get metadata for an Ajo group.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// The group metadata
    ///
    /// # Errors
    /// * `GroupNotFound` - If metadata for the group doesn't exist
    pub fn get_group_metadata(env: Env, group_id: u64) -> Result<GroupMetadata, AjoError> {
        storage::get_group_metadata(&env, group_id).ok_or(AjoError::GroupNotFound)
    }

    /// Get member penalty statistics.
    ///
    /// Returns the penalty record for a member in a specific group, including
    /// late contribution count, on-time count, total penalties paid, and reliability score.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    /// * `member` - The member's address
    ///
    /// # Returns
    /// The member's penalty record
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group doesn't exist
    /// * `NotMember` - If the address is not a member of the group
    pub fn get_member_penalty_record(
        env: Env,
        group_id: u64,
        member: Address,
    ) -> Result<crate::types::MemberPenaltyRecord, AjoError> {
        // Verify group exists
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Verify member
        if !utils::is_member(&group.members, &member) {
            return Err(AjoError::NotMember);
        }

        // Get penalty record or return default
        Ok(storage::get_member_penalty(&env, group_id, &member).unwrap_or(
            crate::types::MemberPenaltyRecord {
                member: member.clone(),
                group_id,
                late_count: 0,
                on_time_count: 0,
                total_penalties: 0,
                reliability_score: 100,
            },
        ))
    }

    /// Get detailed contribution record for a member in a specific cycle.
    ///
    /// Returns the full contribution record including timing, penalty information,
    /// and whether the contribution was late.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    /// * `cycle` - The cycle number
    /// * `member` - The member's address
    ///
    /// # Returns
    /// The detailed contribution record
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group doesn't exist or contribution record doesn't exist
    pub fn get_contribution_detail(
        env: Env,
        group_id: u64,
        cycle: u32,
        member: Address,
    ) -> Result<crate::types::ContributionRecord, AjoError> {
        storage::get_contribution_detail(&env, group_id, cycle, &member)
            .ok_or(AjoError::GroupNotFound)
    }

    /// Get the penalty pool for a specific cycle.
    ///
    /// Returns the total penalties collected during a cycle, which will be
    /// distributed to the payout recipient along with regular contributions.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    /// * `cycle` - The cycle number
    ///
    /// # Returns
    /// Total penalty amount in stroops
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group doesn't exist
    pub fn get_cycle_penalty_pool(env: Env, group_id: u64, cycle: u32) -> Result<i128, AjoError> {
        // Verify group exists
        storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        Ok(storage::get_cycle_penalty_pool(&env, group_id, cycle))
    }

    /// Cancel a group and refund all members.
    ///
    /// Only the group creator can cancel a group, and only before the first payout.
    /// All members who have contributed will receive their token contributions back.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `creator` - Address of the group creator
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// `Ok(())` on successful cancellation and refunds
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group doesn't exist
    /// * `OnlyCreatorCanCancel` - If the caller is not the group creator
    /// * `CannotCancelAfterPayout` - If any payout has been executed
    /// * `GroupCancelled` - If the group is already cancelled
    /// * `GroupComplete` - If the group is already complete
    /// * `InsufficientContractBalance` - If any token refund transfer fails
    pub fn cancel_group(env: Env, creator: Address, group_id: u64) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        creator.require_auth();

        let mut group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Verify creator
        if group.creator != creator {
            return Err(AjoError::OnlyCreatorCanCancel);
        }

        // Check if already cancelled or complete
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }
        if group.state == crate::types::GroupState::Complete {
            return Err(AjoError::GroupComplete);
        }

        // Cannot cancel after first payout
        if group.payout_index > 0 {
            return Err(AjoError::CannotCancelAfterPayout);
        }

        // Calculate refunds for each member who contributed
        let contract_address = env.current_contract_address();
        
        for member in group.members.iter() {
            if storage::has_contributed(&env, group_id, group.current_cycle, &member) {
                let refund_amount = group.contribution_amount;

                // Transfer tokens back to member
                crate::token::transfer_token(
                    &env,
                    &group.token_address,
                    &contract_address,
                    &member,
                    refund_amount,
                )?;

                // Store refund record
                let refund_record = crate::types::RefundRecord {
                    group_id,
                    member: member.clone(),
                    amount: refund_amount,
                    timestamp: utils::get_current_timestamp(&env),
                    reason: crate::types::RefundReason::CreatorCancellation,
                };
                storage::store_refund_record(&env, group_id, &member, &refund_record);

                // Emit refund event
                events::emit_refund_processed(&env, group_id, &member, refund_amount, 0);
            }
        }

        // Update group state
        group.state = crate::types::GroupState::Cancelled;
        storage::store_group(&env, group_id, &group);

        // Emit cancellation event
        events::emit_group_cancelled(
            &env,
            group_id,
            &creator,
            group.members.len(),
            group.contribution_amount,
        );

        Ok(())
    }

    /// Request a refund for a group that has failed to complete.
    ///
    /// Any member can request a refund if the cycle deadline has passed and
    /// not all members have contributed. This initiates a voting period where
    /// members can vote on whether to approve the refund.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `requester` - Address of the member requesting the refund
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// `Ok(())` on successful request creation
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group doesn't exist
    /// * `NotMember` - If the requester is not a member
    /// * `GroupCancelled` - If the group is already cancelled
    /// * `GroupComplete` - If the group is already complete
    /// * `CycleNotExpired` - If the cycle deadline hasn't passed
    /// * `RefundRequestExists` - If a refund request already exists
    pub fn request_refund(env: Env, requester: Address, group_id: u64) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        requester.require_auth();

        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Verify member
        if !utils::is_member(&group.members, &requester) {
            return Err(AjoError::NotMember);
        }

        // Check group state
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }
        if group.state == crate::types::GroupState::Complete {
            return Err(AjoError::GroupComplete);
        }

        // Check if cycle has expired (past grace period)
        let now = utils::get_current_timestamp(&env);
        let grace_end = utils::get_grace_period_end(&group);
        if now <= grace_end {
            return Err(AjoError::CycleNotExpired);
        }

        // Check if a refund request is already pending. A previous request
        // that already ran its vote to completion (rejected for lack of
        // approval or quorum) doesn't block a new one - otherwise a single
        // failed vote would permanently prevent the group from ever
        // requesting a refund again.
        if let Some(existing) = storage::get_refund_request(&env, group_id) {
            if !existing.executed {
                return Err(AjoError::RefundRequestExists);
            }
        }

        // Create refund request
        let voting_deadline = now + crate::types::VOTING_PERIOD;
        let request = crate::types::RefundRequest {
            group_id,
            requester: requester.clone(),
            created_at: now,
            voting_deadline,
            votes_for: 0,
            votes_against: 0,
            executed: false,
            approved: false,
        };

        storage::store_refund_request(&env, group_id, &request);

        // Emit event
        events::emit_refund_requested(&env, group_id, &requester, voting_deadline);

        Ok(())
    }

    /// Vote on a refund request.
    ///
    /// Members can vote in favor or against a refund request during the voting period.
    /// Each member can only vote once.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `voter` - Address of the voting member
    /// * `group_id` - The unique group identifier
    /// * `in_favor` - true to vote in favor, false to vote against
    ///
    /// # Returns
    /// `Ok(())` on successful vote
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group doesn't exist
    /// * `NotMember` - If the voter is not a member
    /// * `NoRefundRequest` - If no refund request exists
    /// * `AlreadyVoted` - If the member has already voted
    /// * `VotingPeriodEnded` - If the voting period has ended
    pub fn vote_refund(
        env: Env,
        voter: Address,
        group_id: u64,
        in_favor: bool,
    ) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        voter.require_auth();

        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Verify member
        if !utils::is_member(&group.members, &voter) {
            return Err(AjoError::NotMember);
        }

        // Get refund request
        let mut request = storage::get_refund_request(&env, group_id)
            .ok_or(AjoError::NoRefundRequest)?;

        // Check if already voted
        if storage::has_voted(&env, group_id, &voter) {
            return Err(AjoError::AlreadyVoted);
        }

        // Check voting period
        let now = utils::get_current_timestamp(&env);
        if now > request.voting_deadline {
            return Err(AjoError::VotingPeriodEnded);
        }

        // Record vote
        let vote = crate::types::RefundVote {
            group_id,
            voter: voter.clone(),
            in_favor,
            timestamp: now,
        };
        storage::store_refund_vote(&env, group_id, &voter, &vote);

        // Update vote counts
        if in_favor {
            request.votes_for += 1;
        } else {
            request.votes_against += 1;
        }
        storage::store_refund_request(&env, group_id, &request);

        // Emit event
        events::emit_refund_vote(&env, group_id, &voter, in_favor);

        Ok(())
    }

    /// Execute a refund after voting period ends.
    ///
    /// Can be called by any member after the voting period ends. If the refund
    /// reaches quorum (at least half the group's members voted) and clears the
    /// approval threshold (>51% of votes cast in favor), all members receive
    /// token refunds based on their contributions.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `executor` - Address executing the refund
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// `Ok(())` whether the refund was approved or not - a request that fails
    /// quorum or approval is a normal, final outcome, not an error. Check
    /// `get_refund_request(group_id).approved` to see which happened.
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group doesn't exist
    /// * `NoRefundRequest` - If no refund request exists
    /// * `VotingPeriodActive` - If the voting period hasn't ended
    /// * `RefundAlreadyExecuted` - If the refund has already been executed
    /// * `InsufficientContractBalance` - If any token refund transfer fails
    pub fn execute_refund(env: Env, executor: Address, group_id: u64) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        executor.require_auth();

        let mut group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        let mut request = storage::get_refund_request(&env, group_id)
            .ok_or(AjoError::NoRefundRequest)?;

        // Check if already executed
        if request.executed {
            return Err(AjoError::RefundAlreadyExecuted);
        }

        // Check voting period ended
        let now = utils::get_current_timestamp(&env);
        if now <= request.voting_deadline {
            return Err(AjoError::VotingPeriodActive);
        }

        // Quorum: at least half the current membership must have voted.
        // Without this, a single member (even just the requester voting for
        // their own request) could unilaterally force a group refund/
        // cancellation the moment the voting window closes, regardless of
        // what the rest of the group wants.
        let total_votes = request.votes_for + request.votes_against;
        let member_count = group.members.len();
        let has_quorum = total_votes.saturating_mul(2) >= member_count;

        let approval_percentage = if total_votes > 0 {
            (request.votes_for * 100) / total_votes
        } else {
            0
        };
        let approved = has_quorum && approval_percentage >= crate::types::REFUND_APPROVAL_THRESHOLD;

        if !approved {
            // A rejected vote is a final, valid outcome - persist it (this
            // call still returns `Ok`, not an error) so it's readable as
            // history, and `request_refund` already treats any `executed`
            // request as resolved rather than blocking a new one.
            request.executed = true;
            request.approved = false;
            storage::store_refund_request(&env, group_id, &request);
            return Ok(());
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // CHECKS-EFFECTS-INTERACTIONS (CEI) ORDERING - SECURITY CRITICAL
        // ═══════════════════════════════════════════════════════════════════════════
        // Per Issue #794 security audit: ALL internal state must be updated BEFORE
        // external calls (token transfers). This prevents reentrancy attacks where a
        // malicious token callback could observe partial state.

        // ─────────────────────────────────────────────────────────────────────────
        // EFFECTS PHASE: Update all internal state before token transfers
        // ─────────────────────────────────────────────────────────────────────────

        // Update request and group state first (before external calls)
        request.executed = true;
        request.approved = true;
        storage::store_refund_request(&env, group_id, &request);

        group.state = crate::types::GroupState::Cancelled;
        storage::store_group(&env, group_id, &group);

        // Store refund records for all members who contributed
        for member in group.members.iter() {
            if storage::has_contributed(&env, group_id, group.current_cycle, &member) {
                let refund_amount = group.contribution_amount;
                let refund_record = crate::types::RefundRecord {
                    group_id,
                    member: member.clone(),
                    amount: refund_amount,
                    timestamp: now,
                    reason: crate::types::RefundReason::MemberVote,
                };
                storage::store_refund_record(&env, group_id, &member, &refund_record);
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // INTERACTIONS PHASE: External calls (token transfers) happen LAST
        // ─────────────────────────────────────────────────────────────────────────

        let contract_address = env.current_contract_address();
        
        for member in group.members.iter() {
            if storage::has_contributed(&env, group_id, group.current_cycle, &member) {
                let refund_amount = group.contribution_amount;

                // Transfer tokens back to member (EXTERNAL CALL - happens last)
                crate::token::transfer_token(
                    &env,
                    &group.token_address,
                    &contract_address,
                    &member,
                    refund_amount,
                )?;

                // Emit refund event after successful transfer
                events::emit_refund_processed(&env, group_id, &member, refund_amount, 1);
            }
        }

        Ok(())
    }

    /// Emergency refund by admin.
    ///
    /// Allows the contract admin to force a refund in case of disputes or emergencies.
    /// All members who have contributed receive their token contributions back.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `admin` - Address of the contract admin
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// `Ok(())` on successful emergency refund and token transfers
    ///
    /// # Errors
    /// * `Unauthorized` - If the caller is not the admin
    /// * `GroupNotFound` - If the group doesn't exist
    /// * `GroupCancelled` - If the group is already cancelled
    /// * `InsufficientContractBalance` - If any token refund transfer fails
    pub fn emergency_refund(env: Env, admin: Address, group_id: u64) -> Result<(), AjoError> {
        admin.require_auth();

        // Verify admin (belt-and-suspenders authorization)
        let stored_admin = storage::get_admin(&env).ok_or(AjoError::Unauthorized)?;
        if admin != stored_admin {
            return Err(AjoError::Unauthorized);
        }

        let mut group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Check if already cancelled
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }

        let now = utils::get_current_timestamp(&env);

        // ═══════════════════════════════════════════════════════════════════════════
        // CHECKS-EFFECTS-INTERACTIONS (CEI) ORDERING - SECURITY CRITICAL
        // ═══════════════════════════════════════════════════════════════════════════
        // Per Issue #794 security audit: ALL internal state must be updated BEFORE
        // external calls (token transfers). This prevents reentrancy attacks where a
        // malicious token callback could observe partial state.

        // ─────────────────────────────────────────────────────────────────────────
        // EFFECTS PHASE: Update all internal state before token transfers
        // ─────────────────────────────────────────────────────────────────────────

        // Update group state first (before external calls)
        group.state = crate::types::GroupState::Cancelled;
        storage::store_group(&env, group_id, &group);

        // Store refund records for all members who contributed
        let mut total_refunded = 0i128;
        for member in group.members.iter() {
            if storage::has_contributed(&env, group_id, group.current_cycle, &member) {
                let refund_amount = group.contribution_amount;
                total_refunded += refund_amount;

                let refund_record = crate::types::RefundRecord {
                    group_id,
                    member: member.clone(),
                    amount: refund_amount,
                    timestamp: now,
                    reason: crate::types::RefundReason::EmergencyRefund,
                };
                storage::store_refund_record(&env, group_id, &member, &refund_record);
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // INTERACTIONS PHASE: External calls (token transfers) happen LAST
        // ─────────────────────────────────────────────────────────────────────────

        let contract_address = env.current_contract_address();

        // Process token transfers for all members who contributed
        for member in group.members.iter() {
            if storage::has_contributed(&env, group_id, group.current_cycle, &member) {
                let refund_amount = group.contribution_amount;

                // Transfer tokens back to member (EXTERNAL CALL - happens last)
                crate::token::transfer_token(
                    &env,
                    &group.token_address,
                    &contract_address,
                    &member,
                    refund_amount,
                )?;

                // Emit refund event after successful transfer
                events::emit_refund_processed(&env, group_id, &member, refund_amount, 2);
            }
        }

        // Emit emergency refund event
        events::emit_emergency_refund(&env, group_id, &admin, total_refunded);

        Ok(())
    }

    /// Get refund request for a group.
    ///
    /// Returns the current refund request if one exists.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    ///
    /// # Returns
    /// The refund request
    ///
    /// # Errors
    /// * `NoRefundRequest` - If no refund request exists
    pub fn get_refund_request(
        env: Env,
        group_id: u64,
    ) -> Result<crate::types::RefundRequest, AjoError> {
        storage::get_refund_request(&env, group_id).ok_or(AjoError::NoRefundRequest)
    }

    /// Get refund record for a member.
    ///
    /// Returns the refund record if the member has received a refund.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The unique group identifier
    /// * `member` - The member's address
    ///
    /// # Returns
    /// The refund record
    ///
    /// # Errors
    /// * `GroupNotFound` - If no refund record exists
pub fn get_refund_record(
        env: Env,
        group_id: u64,
        member: Address,
    ) -> Result<crate::types::RefundRecord, AjoError> {
        storage::get_refund_record(&env, group_id, &member).ok_or(AjoError::GroupNotFound)
    }

    /// Get the contract's token balance for a specific token.
    ///
    /// Returns the amount of tokens held by the contract for a given token address.
    /// Useful for checking if the contract has sufficient funds for payouts.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `token_address` - Address of the token contract
    ///
    /// # Returns
    /// The token balance held by the contract
    pub fn get_contract_balance(env: Env, token_address: Address) -> i128 {
        let contract_address = env.current_contract_address();
        crate::token::get_balance(&env, &token_address, &contract_address)
    }

    /// File an insurance claim for non-payment.
    pub fn file_insurance_claim(
        env: Env,
        claimant: Address,
        group_id: u64,
        cycle: u32,
        defaulter: Address,
        amount: i128,
    ) -> Result<u64, AjoError> {
        claimant.require_auth();
        crate::insurance::file_claim(&env, group_id, cycle, claimant, defaulter, amount)
    }

    /// Process (approve/reject) an insurance claim.
    /// Only the contract admin can process claims.
    pub fn process_insurance_claim(
        env: Env,
        admin: Address,
        claim_id: u64,
        approved: bool,
    ) -> Result<(), AjoError> {
        let contract_admin = storage::get_admin(&env).ok_or(AjoError::Unauthorized)?;
        if admin != contract_admin {
            return Err(AjoError::Unauthorized);
        }
        admin.require_auth();
        crate::insurance::process_claim(&env, claim_id, approved)
    }

    /// Get insurance pool details for a specific token.
    pub fn get_insurance_pool(env: Env, token_address: Address) -> Result<crate::types::InsurancePool, AjoError> {
        storage::get_insurance_pool(&env, &token_address).ok_or(AjoError::PoolNotFound)
    }

    /// Get insurance claim details.
    pub fn get_insurance_claim(env: Env, claim_id: u64) -> Result<crate::types::InsuranceClaim, AjoError> {
        storage::get_insurance_claim(&env, claim_id).ok_or(AjoError::InvalidClaim)
    }

    /// Get risk score for a member.
    pub fn get_member_risk_score(env: Env, member: Address) -> u32 {
        crate::insurance::get_member_risk_score(&env, &member)
    }

    /// Get risk rating for a group.
    pub fn get_group_risk_rating(env: Env, group_id: u64) -> Result<u32, AjoError> {
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        Ok(crate::insurance::get_group_risk_rating(&env, &group))
    }

    /// Get detailed fraud risk profile for a member
    pub fn get_member_fraud_profile(env: Env, member: Address) -> u32 {
        // Return the enhanced risk score instead of a full profile
        crate::insurance::get_member_risk_score(&env, &member)
    }

    /// Get detailed group risk assessment  
    pub fn get_group_risk_assessment(env: Env, group_id: u64) -> Result<u32, AjoError> {
        // Return the enhanced group risk rating
        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        Ok(crate::insurance::get_group_risk_rating(&env, &group))
    }

    // ── Dynamic payout ordering ───────────────────────────────────────────────

    /// Create a new Ajo group with an explicit payout ordering strategy.
    ///
    /// Identical to [`create_group`] except the caller chooses one of the five
    /// [`PayoutOrderingStrategy`] variants.  For `Sequential` behaviour,
    /// [`create_group`] is preferred; this function targets groups that want
    /// `Random`, `VotingBased`, `ContributionBased`, or `NeedBased` ordering.
    pub fn create_group_with_ordering(
        env: Env,
        creator: Address,
        token_address: Address,
        contribution_amount: i128,
        cycle_duration: u64,
        max_members: u32,
        grace_period: u64,
        penalty_rate: u32,
        insurance_rate_bps: u32,
        payout_strategy: PayoutOrderingStrategy,
    ) -> Result<u64, AjoError> {
        utils::validate_group_params(contribution_amount, cycle_duration, max_members)?;
        utils::validate_penalty_params(grace_period, penalty_rate)?;
        pausable::ensure_not_paused(&env)?;
        creator.require_auth();

        let group_id = storage::get_next_group_id(&env);
        let mut members = Vec::new(&env);
        members.push_back(creator.clone());
        let now = utils::get_current_timestamp(&env);

        let group = Group {
            id: group_id,
            creator: creator.clone(),
            token_address,
            contribution_amount,
            cycle_duration,
            max_members,
            members,
            current_cycle: 1,
            payout_index: 0,
            created_at: now,
            cycle_start_time: now,
            is_complete: false,
            grace_period,
            penalty_rate,
            state: crate::types::GroupState::Active,
            insurance_config: crate::types::InsuranceConfig {
                rate_bps: insurance_rate_bps,
                is_enabled: insurance_rate_bps > 0,
            },
            payout_strategy,
            access_type: crate::types::GroupAccessType::Open,
        };

        storage::store_group(&env, group_id, &group);
        events::emit_group_created(&env, group_id, &creator, contribution_amount, max_members);
        Ok(group_id)
    }

    /// Cast a vote for the next payout recipient.
    ///
    /// Only callable for groups whose strategy is [`PayoutOrderingStrategy::VotingBased`]
    /// or [`PayoutOrderingStrategy::NeedBased`].  Each member may vote once per cycle;
    /// calling again replaces the existing vote (last-vote-wins semantics).
    ///
    /// # Arguments
    /// * `voter`    - The member casting the vote (must authenticate).
    /// * `group_id` - The group the vote applies to.
    /// * `nominee`  - The member being nominated to receive the next payout.
    ///
    /// # Errors
    /// * `GroupNotFound`         — group does not exist.
    /// * `VotingNotOpen`         — strategy is not voting-based.
    /// * `NotMember`             — voter or nominee is not a group member.
    /// * `AlreadyReceivedPayout` — nominee has already been paid.
    /// * `GroupComplete`         — all payouts have been distributed.
    /// * `GroupCancelled`        — group was cancelled.
    pub fn vote_for_next_recipient(
        env: Env,
        voter: Address,
        group_id: u64,
        nominee: Address,
    ) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        voter.require_auth();

        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        // Guard: strategy must support voting
        if group.payout_strategy != PayoutOrderingStrategy::VotingBased
            && group.payout_strategy != PayoutOrderingStrategy::NeedBased
        {
            return Err(AjoError::VotingNotOpen);
        }

        // Guard: group must be active
        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }

        // Guard: both voter and nominee must be members
        if !utils::is_member(&group.members, &voter) {
            return Err(AjoError::NotMember);
        }
        if !utils::is_member(&group.members, &nominee) {
            return Err(AjoError::NotMember);
        }

        // Guard: nominee must not have already received their payout
        if storage::has_received_payout(&env, group_id, &nominee) {
            return Err(AjoError::AlreadyReceivedPayout);
        }

        let vote = crate::types::PayoutVote {
            group_id,
            cycle: group.current_cycle,
            voter: voter.clone(),
            nominee: nominee.clone(),
            timestamp: utils::get_current_timestamp(&env),
        };

        storage::store_payout_vote(&env, group_id, group.current_cycle, &voter, &vote);
        events::emit_payout_vote(&env, group_id, &voter, &nominee, group.current_cycle);

        Ok(())
    }

    /// Get the committed payout order recorded for a specific cycle.
    ///
    /// Returns the [`PayoutOrder`](crate::types::PayoutOrder) written by
    /// `execute_payout` for audit and history purposes.
    ///
    /// # Errors
    /// * `GroupNotFound` — no payout order has been recorded for this cycle yet.
    pub fn get_payout_order(
        env: Env,
        group_id: u64,
        cycle: u32,
    ) -> Result<crate::types::PayoutOrder, AjoError> {
        storage::get_payout_order(&env, group_id, cycle).ok_or(AjoError::GroupNotFound)
    }

    // ── Contribution reminders & notifications ────────────────────────────────

    /// Store or update a member's notification preferences.
    ///
    /// The member must authenticate. Preferences apply globally across all
    /// groups the member belongs to.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `member` - Address of the member (must authenticate)
    /// * `enabled` - Master toggle for reminders
    /// * `reminder_hours_before` - Hours before deadline to trigger `ContributionDue`
    /// * `grace_period_reminders` - Whether to receive grace-period reminders
    /// * `payout_notifications` - Whether to receive payout notifications
    ///
    /// # Errors
    /// * `ContractPaused` - If the contract is currently paused
    pub fn set_notification_preferences(
        env: Env,
        member: Address,
        enabled: bool,
        reminder_hours_before: u64,
        grace_period_reminders: bool,
        payout_notifications: bool,
    ) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        member.require_auth();

        let prefs = crate::types::MemberNotificationPreferences {
            member: member.clone(),
            enabled,
            reminder_hours_before,
            grace_period_reminders,
            payout_notifications,
        };

        storage::store_notification_preferences(&env, &member, &prefs);
        events::emit_preferences_updated(&env, &member);

        Ok(())
    }

    /// Retrieve a member's notification preferences.
    ///
    /// # Errors
    /// * `PreferencesNotFound` - If no preferences have been set for this member
    pub fn get_notification_preferences(
        env: Env,
        member: Address,
    ) -> Result<crate::types::MemberNotificationPreferences, AjoError> {
        storage::get_notification_preferences(&env, &member)
            .ok_or(AjoError::PreferencesNotFound)
    }

    /// Trigger contribution reminders for all eligible members of a group.
    ///
    /// Iterates over the group's members and, for each one who has **not** yet
    /// contributed in the current cycle, checks whether a reminder should fire
    /// based on the member's notification preferences and the current time
    /// relative to the cycle deadline and grace period.
    ///
    /// For each triggered reminder the function:
    /// 1. Persists a [`ReminderRecord`](crate::types::ReminderRecord) on-chain.
    /// 2. Emits a `remind` event that off-chain services can consume.
    ///
    /// # Arguments
    /// * `env` - The Soroban contract environment
    /// * `group_id` - The group whose members should be checked
    ///
    /// # Returns
    /// A vector of member addresses that were reminded.
    ///
    /// # Errors
    /// * `GroupNotFound` - If the group does not exist
    /// * `GroupCancelled` - If the group has been cancelled
    /// * `GroupComplete` - If the group has completed all cycles
    pub fn trigger_contribution_reminders(
        env: Env,
        group_id: u64,
    ) -> Result<Vec<Address>, AjoError> {
        let group = storage::get_group(&env, group_id)
            .ok_or(AjoError::GroupNotFound)?;

        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }
        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }

        let now = utils::get_current_timestamp(&env);
        let cycle_end = group.cycle_start_time + group.cycle_duration;
        let grace_end = utils::get_grace_period_end(&group);

        let mut reminded = Vec::new(&env);

        for member in group.members.iter() {
            // Skip members who already contributed this cycle
            if storage::has_contributed(&env, group_id, group.current_cycle, &member) {
                continue;
            }

            // Only remind members who have opted in
            let prefs = match storage::get_notification_preferences(&env, &member) {
                Some(p) if p.enabled => p,
                _ => continue,
            };

            // Determine which reminder type applies right now
            let reminder_type = if now < cycle_end {
                // Before the deadline — check the member's lead-time threshold
                let secs_until_deadline = cycle_end - now;
                let threshold_secs = prefs.reminder_hours_before * 3600;
                if secs_until_deadline <= threshold_secs {
                    Some(crate::types::ReminderType::ContributionDue)
                } else {
                    None
                }
            } else if now <= grace_end && prefs.grace_period_reminders {
                Some(crate::types::ReminderType::GracePeriod)
            } else if now > grace_end {
                Some(crate::types::ReminderType::Overdue)
            } else {
                None
            };

            if let Some(rtype) = reminder_type {
                let record = crate::types::ReminderRecord {
                    group_id,
                    cycle: group.current_cycle,
                    member: member.clone(),
                    reminder_type: rtype,
                    triggered_at: now,
                    deadline: cycle_end,
                };

                storage::store_reminder_record(
                    &env,
                    group_id,
                    group.current_cycle,
                    &member,
                    &record,
                );

                events::emit_reminder_triggered(
                    &env,
                    group_id,
                    &member,
                    rtype as u32,
                    cycle_end,
                );

                reminded.push_back(member);
            }
        }

        Ok(reminded)
    }

    /// Retrieve the reminder record for a member in a specific group and cycle.
    ///
    /// # Errors
    /// * `GroupNotFound` - If no reminder record exists for the given parameters
    pub fn get_reminder_history(
        env: Env,
        group_id: u64,
        cycle: u32,
        member: Address,
    ) -> Result<crate::types::ReminderRecord, AjoError> {
        storage::get_reminder_record(&env, group_id, cycle, &member)
            .ok_or(AjoError::GroupNotFound)
    }

    // ── Milestones & Achievements ─────────────────────────────────────────

    /// Returns all milestones achieved by a group.
    pub fn get_group_milestones(
        env: Env,
        group_id: u64,
    ) -> Result<Vec<MilestoneRecord>, AjoError> {
        // Verify group exists
        storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;
        Ok(storage::get_group_milestones(&env, group_id)
            .unwrap_or_else(|| Vec::new(&env)))
    }

    /// Returns all achievements earned by a member.
    pub fn get_member_achievements(
        env: Env,
        member: Address,
    ) -> Result<Vec<AchievementRecord>, AjoError> {
        Ok(storage::get_member_achievements(&env, &member)
            .unwrap_or_else(|| Vec::new(&env)))
    }

    /// Returns aggregated statistics for a member across all groups.
    pub fn get_member_stats(
        env: Env,
        member: Address,
    ) -> Result<MemberStats, AjoError> {
        Ok(storage::get_member_stats(&env, &member)
            .unwrap_or_else(|| utils::default_member_stats(&env, &member)))
    }

    // ── Multi-token support ───────────────────────────────────────────────

    /// Create a new multi-token Ajo group that accepts contributions in
    /// multiple Stellar assets.
    ///
    /// The first token in `accepted_tokens` is the *primary* token and is
    /// also stored as the group's `token_address` for backward-compatible
    /// queries.  The `contribution_amount` is denominated in the primary
    /// token; for other tokens the required amount is scaled by weight.
    ///
    /// # Arguments
    /// * `env`                 - The Soroban contract environment
    /// * `creator`             - Address of the group creator
    /// * `accepted_tokens`     - List of [`TokenConfig`] (address + weight)
    /// * `contribution_amount` - Base contribution per cycle in primary-token units
    /// * `cycle_duration`      - Cycle length in seconds
    /// * `max_members`         - Cap on group membership (2–100)
    /// * `grace_period`        - Seconds after cycle end before penalty kicks in
    /// * `penalty_rate`        - Late-contribution penalty as a percentage (0–100)
    /// * `insurance_rate_bps`  - Insurance premium in basis points (0 = disabled)
    ///
    /// # Errors
    /// * `EmptyTokenList`   – `accepted_tokens` is empty
    /// * `TooManyTokens`    – more than [`MAX_ACCEPTED_TOKENS`] entries
    /// * `InvalidWeight`    – any token has `weight == 0`
    /// * `DuplicateToken`   – the same address appears twice
    /// * Standard group-creation errors from [`validate_group_params`]
    pub fn create_multi_token_group(
        env: Env,
        creator: Address,
        accepted_tokens: Vec<crate::types::TokenConfig>,
        contribution_amount: i128,
        cycle_duration: u64,
        max_members: u32,
        grace_period: u64,
        penalty_rate: u32,
        insurance_rate_bps: u32,
    ) -> Result<u64, AjoError> {
        // Validate token list
        utils::validate_token_list(&env, &accepted_tokens)?;

        // Standard parameter validation
        utils::validate_group_params(contribution_amount, cycle_duration, max_members)?;
        utils::validate_penalty_params(grace_period, penalty_rate)?;
        pausable::ensure_not_paused(&env)?;
        creator.require_auth();

        let group_id = storage::get_next_group_id(&env);
        let mut members = Vec::new(&env);
        members.push_back(creator.clone());
        let now = utils::get_current_timestamp(&env);

        // Use the first token as the primary / backward-compatible token_address
        let primary_token = accepted_tokens.get(0).unwrap();

        let group = Group {
            id: group_id,
            creator: creator.clone(),
            token_address: primary_token.address.clone(),
            contribution_amount,
            cycle_duration,
            max_members,
            members,
            current_cycle: 1,
            payout_index: 0,
            created_at: now,
            cycle_start_time: now,
            is_complete: false,
            grace_period,
            penalty_rate,
            state: crate::types::GroupState::Active,
            insurance_config: crate::types::InsuranceConfig {
                rate_bps: insurance_rate_bps,
                is_enabled: insurance_rate_bps > 0,
            },
            payout_strategy: PayoutOrderingStrategy::Sequential,
            access_type: crate::types::GroupAccessType::Open,
        };

        storage::store_group(&env, group_id, &group);

        // Store the multi-token configuration alongside the group
        let mt_config = crate::types::MultiTokenConfig {
            group_id,
            accepted_tokens: accepted_tokens.clone(),
        };
        storage::store_multi_token_config(&env, group_id, &mt_config);

        events::emit_multi_token_group_created(
            &env,
            group_id,
            &creator,
            contribution_amount,
            accepted_tokens.len(),
        );

        Ok(group_id)
    }

    /// Contribute to a multi-token group using a specific accepted token.
    ///
    /// The required amount is calculated from the group's base
    /// `contribution_amount` and the token's weight relative to the
    /// primary token:
    ///
    /// ```text
    /// required = contribution_amount × primary_weight / token_weight
    /// ```
    ///
    /// After a successful transfer the member's contribution is recorded
    /// exactly like a normal `contribute` call so that existing payout
    /// logic continues to work.
    ///
    /// # Arguments
    /// * `env`           - The Soroban contract environment
    /// * `member`        - The contributing member (must authenticate)
    /// * `group_id`      - Target group
    /// * `token_address` - The token to contribute with
    ///
    /// # Errors
    /// * `NotMultiTokenGroup` – group was not created with multi-token support
    /// * `TokenNotAccepted`   – `token_address` is not in accepted list
    /// * Standard contribution errors (NotMember, AlreadyContributed, etc.)
    pub fn contribute_with_token(
        env: Env,
        member: Address,
        group_id: u64,
        token_address: Address,
    ) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        member.require_auth();

        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }
        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }
        if !utils::is_member(&group.members, &member) {
            return Err(AjoError::NotMember);
        }
        if storage::has_contributed(&env, group.id, group.current_cycle, &member) {
            return Err(AjoError::AlreadyContributed);
        }

        // Fetch multi-token config — fail if this is a single-token group
        let mt_config = storage::get_multi_token_config(&env, group_id)
            .ok_or(AjoError::NotMultiTokenGroup)?;

        // Locate the requested token in the accepted list
        let (token_cfg, primary_weight) =
            utils::find_token_config(&mt_config, &token_address)?;

        // Calculate the required amount in the chosen token's units
        let required_amount = utils::calculate_equivalent_amount(
            group.contribution_amount,
            primary_weight,
            token_cfg.weight,
        );

        let contract_address = env.current_contract_address();

        // Balance check and transfer
        crate::token::check_balance(&env, &token_address, &member, required_amount)?;
        crate::token::transfer_token(
            &env,
            &token_address,
            &member,
            &contract_address,
            required_amount,
        )?;

        // Mark the standard contribution flag (keeps existing payout logic working)
        storage::store_contribution(&env, group.id, group.current_cycle, &member, true);

        // Store token-specific record for auditability
        let tk_record = crate::types::TokenContribution {
            member: member.clone(),
            token: token_address.clone(),
            amount: required_amount,
            cycle: group.current_cycle,
        };
        storage::store_token_contribution(&env, group.id, group.current_cycle, &member, &tk_record);

        // Track per-token balance for multi-token payout
        storage::add_group_token_balance(
            &env,
            group.id,
            group.current_cycle,
            &token_address,
            required_amount,
        );

        // Insurance premium
        if group.insurance_config.is_enabled {
            let premium = crate::insurance::calculate_premium(
                required_amount,
                group.insurance_config.rate_bps,
            );
            if premium > 0 {
                crate::insurance::deposit_to_pool(&env, &token_address, premium);
            }
        }

        events::emit_token_contribution(
            &env,
            group.id,
            &member,
            &token_address,
            required_amount,
            group.current_cycle,
        );

        // Update member stats
        let mut stats = storage::get_member_stats(&env, &member)
            .unwrap_or_else(|| utils::default_member_stats(&env, &member));
        stats.total_contributions += 1;
        stats.on_time_contributions += 1;
        stats.total_amount_contributed += required_amount;
        if required_amount >= crate::reputation::MIN_REPUTATION_STAKE {
            stats.qualifying_contributions += 1;
            stats.qualifying_ontime_contribs += 1;
            stats.qualifying_amount_contributed += required_amount;
        }
        storage::store_member_stats(&env, &member, &stats);

        Ok(())
    }

    /// Execute payout for a multi-token group.
    ///
    /// For each accepted token that has a non-zero accumulated balance in
    /// the current cycle, the full balance is transferred to the payout
    /// recipient.  This means the recipient receives contributions in each
    /// token that members actually used.
    ///
    /// All the standard payout guards apply (all contributed, grace period
    /// expired, group not complete, etc.).
    ///
    /// # Errors
    /// * `NotMultiTokenGroup` – group was not created with multi-token support
    /// * Standard payout errors (IncompleteContributions, GroupComplete, etc.)
    pub fn execute_multi_token_payout(env: Env, group_id: u64) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;

        let mut group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }
        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }
        if !utils::all_members_contributed(&env, &group) {
            return Err(AjoError::IncompleteContributions);
        }

        let current_time = utils::get_current_timestamp(&env);
        let grace_end = utils::get_grace_period_end(&group);
        if current_time < grace_end {
            return Err(AjoError::OutsideCycleWindow);
        }

        let mt_config = storage::get_multi_token_config(&env, group_id)
            .ok_or(AjoError::NotMultiTokenGroup)?;

        let payout_recipient = utils::determine_next_recipient(&env, &group)?;
        let contract_address = env.current_contract_address();
        let current_cycle = group.current_cycle;

        // Transfer each token's accumulated balance to the recipient
        for tc in mt_config.accepted_tokens.iter() {
            let balance = storage::get_group_token_balance(
                &env,
                group.id,
                current_cycle,
                &tc.address,
            );
            if balance > 0 {
                // Add any penalty bonus proportionally from the primary token pool
                let penalty_bonus = if tc.address == group.token_address {
                    storage::get_cycle_penalty_pool(&env, group.id, current_cycle)
                } else {
                    0
                };
                let payout_amount = balance + penalty_bonus;

                crate::token::check_contract_balance(
                    &env,
                    &tc.address,
                    &contract_address,
                    payout_amount,
                )?;

                crate::token::transfer_token(
                    &env,
                    &tc.address,
                    &contract_address,
                    &payout_recipient,
                    payout_amount,
                )?;

                events::emit_multi_token_payout(
                    &env,
                    group.id,
                    &payout_recipient,
                    &tc.address,
                    payout_amount,
                    current_cycle,
                );
            }
        }

        storage::mark_payout_received(&env, group.id, &payout_recipient);

        events::emit_payout_order_determined(
            &env,
            group.id,
            current_cycle,
            &payout_recipient,
            group.payout_strategy as u32,
        );

        // Advance cycle or mark complete
        group.payout_index += 1;
        if group.payout_index >= group.members.len() as u32 {
            group.is_complete = true;
            group.state = crate::types::GroupState::Complete;
            events::emit_group_completed(&env, group.id);
        } else {
            group.current_cycle += 1;
            group.cycle_start_time = utils::get_current_timestamp(&env);
        }

        storage::store_group(&env, group_id, &group);

        // Milestones
        let milestones = utils::check_group_milestones(&env, &group);
        for milestone in milestones.iter() {
            let record = MilestoneRecord {
                group_id: group.id,
                milestone,
                achieved_at: utils::get_current_timestamp(&env),
                cycle_number: current_cycle,
            };
            storage::add_group_milestone(&env, group.id, &record);
            events::emit_milestone_achieved(&env, group.id, record.milestone as u32, current_cycle);
        }

        if group.is_complete {
            let qualifies = group.contribution_amount >= crate::reputation::MIN_REPUTATION_STAKE;
            for m in group.members.iter() {
                let mut stats = storage::get_member_stats(&env, &m)
                    .unwrap_or_else(|| utils::default_member_stats(&env, &m));
                stats.total_groups_completed += 1;
                if qualifies {
                    stats.qualifying_groups_completed += 1;
                }
                storage::store_member_stats(&env, &m, &stats);
            }
        }

        Ok(())
    }

    /// Returns the multi-token configuration for a group.
    ///
    /// # Errors
    /// * `NotMultiTokenGroup` – group has no multi-token config
    pub fn get_multi_token_config(
        env: Env,
        group_id: u64,
    ) -> Result<crate::types::MultiTokenConfig, AjoError> {
        storage::get_multi_token_config(&env, group_id)
            .ok_or(AjoError::NotMultiTokenGroup)
    }

    /// Returns the accepted tokens for a multi-token group.
    ///
    /// # Errors
    /// * `NotMultiTokenGroup` – group has no multi-token config
    pub fn get_accepted_tokens(
        env: Env,
        group_id: u64,
    ) -> Result<Vec<crate::types::TokenConfig>, AjoError> {
        let config = storage::get_multi_token_config(&env, group_id)
            .ok_or(AjoError::NotMultiTokenGroup)?;
        Ok(config.accepted_tokens)
    }

    /// Returns the token-specific contribution record for a member in a cycle.
    ///
    /// # Errors
    /// * `GroupNotFound` – no contribution record found
    pub fn get_token_contribution(
        env: Env,
        group_id: u64,
        cycle: u32,
        member: Address,
    ) -> Result<crate::types::TokenContribution, AjoError> {
        storage::get_token_contribution(&env, group_id, cycle, &member)
            .ok_or(AjoError::GroupNotFound)
    }

    /// Returns whether a group is configured for multi-token contributions.
    pub fn is_multi_token_group(env: Env, group_id: u64) -> bool {
        storage::is_multi_token_group(&env, group_id)
    }

    // ── Dispute Resolution ────────────────────────────────────────────────

    /// File a dispute against a member in a group.
    ///
    /// Both complainant and defendant must be members of the group, and must
    /// be different members - a member cannot dispute themselves.
    ///
    /// # Errors
    /// * `GroupNotFound` – group doesn't exist
    /// * `GroupCancelled` – group has been cancelled
    /// * `GroupComplete` – group has finished all cycles
    /// * `NotMember` – complainant or defendant is not a member
    /// * `Unauthorized` – complainant and defendant are the same address
    pub fn file_dispute(
        env: Env,
        complainant: Address,
        group_id: u64,
        defendant: Address,
        dispute_type: crate::types::DisputeType,
        description: soroban_sdk::String,
        evidence_hash: soroban_sdk::BytesN<32>,
        proposed_resolution: crate::types::DisputeResolution,
    ) -> Result<u64, AjoError> {
        pausable::ensure_not_paused(&env)?;
        complainant.require_auth();

        let group = storage::get_group(&env, group_id).ok_or(AjoError::GroupNotFound)?;

        if group.state == crate::types::GroupState::Cancelled {
            return Err(AjoError::GroupCancelled);
        }
        if group.is_complete {
            return Err(AjoError::GroupComplete);
        }

        if !utils::is_member(&group.members, &complainant) {
            return Err(AjoError::NotMember);
        }
        if !utils::is_member(&group.members, &defendant) {
            return Err(AjoError::NotMember);
        }
        // A self-filed dispute would let a member vote it through solo (see
        // the defendant-cannot-vote check in `vote_on_dispute`) and collect
        // whatever the proposed resolution grants the complainant - reusing
        // `Unauthorized` here since the error enum is at Soroban's 50-case
        // spec limit (see the doc comment on `AjoError`).
        if complainant == defendant {
            return Err(AjoError::Unauthorized);
        }

        let now = utils::get_current_timestamp(&env);
        let dispute_id = storage::get_next_dispute_id(&env);

        let dispute = crate::types::Dispute {
            id: dispute_id,
            group_id,
            dispute_type,
            complainant: complainant.clone(),
            defendant: defendant.clone(),
            description,
            evidence_hash,
            status: crate::types::DisputeStatus::Open,
            created_at: now,
            voting_deadline: now + crate::types::DISPUTE_VOTING_PERIOD,
            votes_for_action: 0,
            votes_against_action: 0,
            proposed_resolution,
            final_resolution: crate::types::DisputeResolution::NoAction,
        };

        storage::store_dispute(&env, dispute_id, &dispute);

        // Track dispute ID under the group
        let mut ids = storage::get_group_dispute_ids(&env, group_id);
        ids.push_back(dispute_id);
        storage::store_group_dispute_ids(&env, group_id, &ids);

        events::emit_dispute_filed(&env, dispute_id, group_id, &complainant, &defendant);

        Ok(dispute_id)
    }

    /// Vote on an open dispute.
    ///
    /// Any group member (except the defendant) may vote once during the voting period.
    ///
    /// # Errors
    /// * `DisputeNotFound` – dispute doesn't exist
    /// * `DisputeAlreadyResolved` – dispute is already resolved
    /// * `NotMember` – voter is not a member of the group
    /// * `Unauthorized` – voter is the dispute's defendant
    /// * `AlreadyVotedOnDispute` – voter has already voted
    /// * `VotingPeriodEnded` – voting period has ended
    pub fn vote_on_dispute(
        env: Env,
        voter: Address,
        dispute_id: u64,
        supports_action: bool,
    ) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        voter.require_auth();

        let mut dispute = storage::get_dispute(&env, dispute_id)
            .ok_or(AjoError::DisputeNotFound)?;

        if dispute.status == crate::types::DisputeStatus::Resolved
            || dispute.status == crate::types::DisputeStatus::Rejected
        {
            return Err(AjoError::DisputeAlreadyResolved);
        }

        let group = storage::get_group(&env, dispute.group_id).ok_or(AjoError::GroupNotFound)?;
        if !utils::is_member(&group.members, &voter) {
            return Err(AjoError::NotMember);
        }
        // The defendant can't vote on their own case - reuses `Unauthorized`
        // for the same 50-case-limit reason noted on `file_dispute`.
        if voter == dispute.defendant {
            return Err(AjoError::Unauthorized);
        }

        if storage::has_voted_on_dispute(&env, dispute_id, &voter) {
            return Err(AjoError::AlreadyVotedOnDispute);
        }

        let now = utils::get_current_timestamp(&env);
        if now > dispute.voting_deadline {
            return Err(AjoError::VotingPeriodEnded);
        }

        let vote = crate::types::DisputeVote {
            dispute_id,
            voter: voter.clone(),
            supports_action,
            timestamp: now,
        };
        storage::store_dispute_vote(&env, dispute_id, &voter, &vote);

        if supports_action {
            dispute.votes_for_action += 1;
        } else {
            dispute.votes_against_action += 1;
        }
        dispute.status = crate::types::DisputeStatus::Voting;
        storage::store_dispute(&env, dispute_id, &dispute);

        events::emit_dispute_vote(&env, dispute_id, &voter, supports_action);

        Ok(())
    }

    /// Resolve a dispute after the voting period ends.
    ///
    /// Requires quorum - at least half of the members eligible to vote (every
    /// member except the defendant) must have voted - and, among votes cast,
    /// ≥66% support for the action. Otherwise the dispute is rejected. Either
    /// outcome is final and returns `Ok`; there is no state where a dispute
    /// past its deadline is left unresolved.
    ///
    /// # Errors
    /// * `DisputeNotFound` – dispute doesn't exist
    /// * `DisputeAlreadyResolved` – already resolved
    /// * `VotingPeriodActive` – voting period hasn't ended yet
    pub fn resolve_dispute(
        env: Env,
        resolver: Address,
        dispute_id: u64,
    ) -> Result<(), AjoError> {
        pausable::ensure_not_paused(&env)?;
        resolver.require_auth();

        let mut dispute = storage::get_dispute(&env, dispute_id)
            .ok_or(AjoError::DisputeNotFound)?;

        if dispute.status == crate::types::DisputeStatus::Resolved
            || dispute.status == crate::types::DisputeStatus::Rejected
        {
            return Err(AjoError::DisputeAlreadyResolved);
        }

        let now = utils::get_current_timestamp(&env);
        if now <= dispute.voting_deadline {
            return Err(AjoError::VotingPeriodActive);
        }

        // Quorum is measured against members eligible to vote right now (the
        // defendant is excluded from both the count and the vote itself), so
        // a dispute can't be forced through by a lone voter regardless of
        // group size - without this, resolving with a single "for" vote and
        // no "against" always clears the 66% approval threshold on its own.
        let group = storage::get_group(&env, dispute.group_id).ok_or(AjoError::GroupNotFound)?;
        let eligible_voters = group
            .members
            .iter()
            .filter(|m| *m != dispute.defendant)
            .count() as u32;

        let total_votes = dispute.votes_for_action + dispute.votes_against_action;
        let has_quorum = total_votes.saturating_mul(2) >= eligible_voters;
        let approved = has_quorum
            && total_votes > 0
            && (dispute.votes_for_action * 100 / total_votes)
                >= crate::types::DISPUTE_APPROVAL_THRESHOLD;

        if approved {
            dispute.status = crate::types::DisputeStatus::Resolved;
            dispute.final_resolution = dispute.proposed_resolution;

            // Apply resolution
            match dispute.proposed_resolution {
                crate::types::DisputeResolution::Penalty => {
                    let group = storage::get_group(&env, dispute.group_id)
                        .ok_or(AjoError::GroupNotFound)?;
                    let penalty_amount = group.contribution_amount
                        * (group.penalty_rate as i128)
                        / 100;
                    // This assesses the penalty on the defendant's reliability
                    // record only. It is NOT added to the cycle's penalty pool:
                    // that pool backs real tokens collected as a late-payment
                    // surcharge in `contribute`, and `execute_payout` pays it
                    // straight out. `resolve_dispute` can be called by any
                    // member, not the defendant, so there is no authorization
                    // to actually pull matching funds from them here - crediting
                    // the pool without collecting the tokens would let a payout
                    // try to disburse money the contract was never given.
                    // Record penalty on defendant
                    let mut penalty_record = storage::get_member_penalty(
                        &env,
                        dispute.group_id,
                        &dispute.defendant,
                    )
                    .unwrap_or(crate::types::MemberPenaltyRecord {
                        member: dispute.defendant.clone(),
                        group_id: dispute.group_id,
                        late_count: 0,
                        on_time_count: 0,
                        total_penalties: 0,
                        reliability_score: 100,
                    });
                    penalty_record.late_count += 1;
                    penalty_record.total_penalties += penalty_amount;
                    storage::store_member_penalty(&env, dispute.group_id, &dispute.defendant, &penalty_record);
                }
                crate::types::DisputeResolution::Removal => {
                    let mut group = storage::get_group(&env, dispute.group_id)
                        .ok_or(AjoError::GroupNotFound)?;
                    let mut new_members = Vec::new(&env);
                    for m in group.members.iter() {
                        if m != dispute.defendant {
                            new_members.push_back(m);
                        }
                    }
                    group.members = new_members;

                    // `payout_index` is both "how many payouts have happened"
                    // (compared against member count to detect completion)
                    // and, for the Sequential strategy, a raw position into
                    // `members`. Removing a member who already received their
                    // payout shrinks the member list without any payout
                    // having been undone, so the count must shrink with it -
                    // otherwise the group reaches `is_complete` one payout
                    // early (Random/VotingBased/ContributionBased) or
                    // Sequential's index silently lands on the member who
                    // should be next in line and skips them entirely.
                    if storage::has_received_payout(&env, dispute.group_id, &dispute.defendant) {
                        group.payout_index = group.payout_index.saturating_sub(1);
                    }

                    storage::store_group(&env, dispute.group_id, &group);
                }
                crate::types::DisputeResolution::Refund => {
                    let group = storage::get_group(&env, dispute.group_id)
                        .ok_or(AjoError::GroupNotFound)?;
                    let refund_record = crate::types::RefundRecord {
                        group_id: dispute.group_id,
                        member: dispute.complainant.clone(),
                        amount: group.contribution_amount,
                        reason: crate::types::RefundReason::DisputeRefund,
                        timestamp: now,
                    };
                    storage::store_refund_record(
                        &env,
                        dispute.group_id,
                        &dispute.complainant,
                        &refund_record,
                    );
                }
                _ => {}
            }
        } else {
            dispute.status = crate::types::DisputeStatus::Rejected;
            dispute.final_resolution = crate::types::DisputeResolution::NoAction;
        }

        storage::store_dispute(&env, dispute_id, &dispute);
        events::emit_dispute_resolved(&env, dispute_id, dispute.group_id, dispute.final_resolution);

        Ok(())
    }

    /// Returns a dispute by ID.
    ///
    /// # Errors
    /// * `DisputeNotFound` – dispute doesn't exist
    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<crate::types::Dispute, AjoError> {
        storage::get_dispute(&env, dispute_id).ok_or(AjoError::DisputeNotFound)
    }

    /// Returns all dispute IDs for a group.
    pub fn get_group_disputes(env: Env, group_id: u64) -> Vec<u64> {
        storage::get_group_dispute_ids(&env, group_id)
    }

    // ── Group templates ───────────────────────────────────────────────────

    /// Create a group using a predefined template.
    ///
    /// Applies the template's default cycle duration, grace period, and penalty
    /// rate while letting the caller choose the contribution amount and member cap.
    /// The contribution amount must be at least the template's
    /// `suggested_contribution_min`.
    ///
    /// # Arguments
    /// * `env`                  - The Soroban contract environment
    /// * `creator`              - Address of the group creator
    /// * `token_address`        - Token contract address for contributions/payouts
    /// * `template`             - The [`GroupTemplate`] to apply
    /// * `contribution_amount`  - Contribution per cycle in stroops (≥ template min)
    /// * `max_members`          - Maximum members (2–100)
    ///
    /// # Returns
    /// The unique group ID of the newly created group.
    ///
    /// # Errors
    /// * `ContributionAmountZero` – if `contribution_amount` is below the template minimum
    /// * Standard [`create_group`] errors for invalid parameters
    pub fn create_group_from_template(
        env: Env,
        creator: Address,
        token_address: Address,
        template: crate::types::GroupTemplate,
        contribution_amount: i128,
        max_members: u32,
    ) -> Result<u64, AjoError> {
        let config = utils::get_template_config(template);

        // Enforce template minimum contribution
        if contribution_amount < config.suggested_contribution_min {
            return Err(AjoError::ContributionAmountZero);
        }

        Self::create_group(
            env,
            creator,
            token_address,
            contribution_amount,
            config.default_cycle_duration,
            max_members,
            config.default_grace_period,
            config.default_penalty_rate,
            0, // No insurance by default
        )
    }

    /// Return the [`TemplateConfig`] for a given [`GroupTemplate`].
    ///
    /// Useful for clients that want to display template defaults before
    /// asking the user to confirm or customise parameters.
    pub fn get_template_config(
        _env: Env,
        template: crate::types::GroupTemplate,
    ) -> crate::types::TemplateConfig {
        utils::get_template_config(template)
    }

    /// Return all available [`GroupTemplate`] variants.
    pub fn list_available_templates(env: Env) -> Vec<crate::types::GroupTemplate> {
        let mut templates = Vec::new(&env);
        templates.push_back(crate::types::GroupTemplate::MonthlySavings);
        templates.push_back(crate::types::GroupTemplate::WeeklySavings);
        templates.push_back(crate::types::GroupTemplate::EmergencyFund);
        templates.push_back(crate::types::GroupTemplate::InvestmentClub);
        templates.push_back(crate::types::GroupTemplate::Custom);
        templates
    }

    // ── Reputation system ─────────────────────────────────────────────────────

    /// Get the full on-chain reputation record for a member.
    ///
    /// Returns the stored [`ReputationScore`] if one exists, or a default
    /// zero-score record for members who have not yet built any history.
    /// This is a pure read — it never modifies state.
    ///
    /// # Arguments
    /// * `env`    - The Soroban contract environment
    /// * `member` - The member's Stellar address
    ///
    /// # Returns
    /// The member's current [`ReputationScore`]
    pub fn get_reputation(env: Env, member: Address) -> crate::types::ReputationScore {
        crate::reputation::get_reputation(&env, &member)
    }

    /// Get the current credit score for a member (0–1000).
    ///
    /// Convenience wrapper around [`get_reputation`] that returns only the
    /// numeric score.  Returns 0 for members with no history.
    ///
    /// # Arguments
    /// * `env`    - The Soroban contract environment
    /// * `member` - The member's Stellar address
    pub fn get_credit_score(env: Env, member: Address) -> u32 {
        crate::reputation::get_reputation(&env, &member).credit_score
    }

    /// Get the payment history for a member.
    ///
    /// Returns an ordered list of [`PaymentHistoryEntry`] records covering
    /// both contributions made and payouts received.  The list is capped at
    /// [`MAX_PAYMENT_HISTORY`](crate::types::MAX_PAYMENT_HISTORY) entries
    /// (oldest entries are dropped when the cap is reached).
    ///
    /// # Arguments
    /// * `env`    - The Soroban contract environment
    /// * `member` - The member's Stellar address
    ///
    /// # Returns
    /// Vector of payment history entries, oldest first
    pub fn get_payment_history(
        env: Env,
        member: Address,
    ) -> soroban_sdk::Vec<crate::types::PaymentHistoryEntry> {
        crate::reputation::get_payment_history(&env, &member)
    }

    /// Get the credit score snapshot history for a member.
    ///
    /// Returns an ordered list of [`CreditScoreSnapshot`] records showing
    /// how the member's score has changed over time.  Capped at
    /// [`MAX_SCORE_HISTORY`](crate::types::MAX_SCORE_HISTORY) entries.
    ///
    /// # Arguments
    /// * `env`    - The Soroban contract environment
    /// * `member` - The member's Stellar address
    ///
    /// # Returns
    /// Vector of score snapshots, oldest first
    pub fn get_credit_score_history(
        env: Env,
        member: Address,
    ) -> soroban_sdk::Vec<crate::types::CreditScoreSnapshot> {
        crate::reputation::get_credit_score_history(&env, &member)
    }

    /// Manually trigger a reputation recalculation for a member.
    ///
    /// Reputation is updated automatically on every contribution and payout,
    /// but this function allows an explicit refresh — useful after admin
    /// corrections or data migrations.
    ///
    /// # Arguments
    /// * `env`    - The Soroban contract environment
    /// * `caller` - The address requesting the refresh (must authenticate)
    /// * `member` - The member whose reputation should be recalculated
    ///
    /// # Returns
    /// The freshly computed [`ReputationScore`]
    ///
    /// # Errors
    /// * `ContractPaused` - If the contract is paused
    pub fn refresh_reputation(
        env: Env,
        caller: Address,
        member: Address,
    ) -> Result<crate::types::ReputationScore, AjoError> {
        pausable::ensure_not_paused(&env)?;
        caller.require_auth();
        crate::reputation::update_member_reputation(&env, &member)
    }

    /// Check whether a member meets a minimum credit score requirement.
    ///
    /// Returns `Ok(())` if the member's score is at or above `min_score`,
    /// or if `min_score` is 0 (no requirement).  Useful for group creators
    /// who want to gate membership on reputation.
    ///
    /// # Arguments
    /// * `env`       - The Soroban contract environment
    /// * `member`    - The member to check
    /// * `min_score` - Minimum required credit score (0 = no requirement)
    ///
    /// # Errors
    /// * `InsufficientCreditScore` - If the member's score is below `min_score`
    pub fn check_credit_requirement(
        env: Env,
        member: Address,
        min_score: u32,
    ) -> Result<(), AjoError> {
        crate::reputation::check_credit_requirement(&env, &member, min_score)
    }
}

