#![no_std]
#![allow(dead_code)]

//! # Soroban Ajo (Esusu) Contract
//!
//! This contract implements a decentralized rotational savings and credit association (ROSCA).
//! Members join a group, contribute a fixed amount each cycle, and receive payouts in rotation.
//!
//! ## Key Features
//! - Trustless group savings
//! - Automated payout rotation
//! - Transparent contribution tracking
//! - Native XLM support

mod contract;
mod errors;
mod events;
mod pausable;
mod reputation;
mod security;
mod storage;
mod token;
mod types;
mod utils;
mod insurance;
mod loan;
mod emergency;
pub mod multisig;

pub use contract::AjoContract;
pub use contract::AjoContractClient;
pub use errors::AjoError;
pub use types::{GroupState, RefundReason, RefundRequest, RefundRecord, RefundVote};
pub use types::{PayoutOrderingStrategy, PayoutVote, PayoutOrder};
pub use types::{ReminderType, MemberNotificationPreferences, ReminderRecord};
pub use types::{GroupMilestone, MemberAchievement, MilestoneRecord, AchievementRecord, MemberStats};
pub use types::{TokenConfig, MultiTokenConfig, TokenContribution};
pub use types::{Dispute, DisputeType, DisputeStatus, DisputeResolution, DisputeVote};
pub use types::{GroupTemplate, TemplateConfig};
pub use types::{
    ReputationScore, ReputationTier, CreditScoreSnapshot, PaymentHistoryEntry, ScoreChangeReason,
};
