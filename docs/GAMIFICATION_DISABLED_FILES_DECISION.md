# Gamification Disabled Files — Diff & Decision Document

**Issue:** #810  
**Decision:** Port-then-delete  
**Status:** Implemented

---

## 1. Files Under Review

| File | Status |
|------|--------|
| `backend/src/services/gamification/AchievementService.ts.disabled` | Disabled, pending review |
| `backend/src/services/gamification/ChallengeService.ts.disabled` | Disabled, pending review |
| `backend/src/services/gamification/GamificationService.ts` | Active (new architecture) |
| `backend/src/services/gamificationService.ts` | Active (legacy, monolithic) |
| `backend/src/services/AchievementTracker.ts` | Active (used by RewardEngine) |

---

## 2. Why Were They Disabled?

The disabled files import `pointsService`, `achievementRequirementSchema`, `challengeRequirementSchema`, and `DuplicateRewardError` — all of which exist and compile cleanly. Inspection of `GamificationService.ts` shows they were disabled mid-refactor with explicit `// Temporarily disabled` comments:

```ts
// import { achievementService } from './AchievementService'; // Temporarily disabled
// import { challengeService } from './ChallengeService'; // Temporarily disabled
```

The new `GamificationService` architecture split the monolithic `gamificationService.ts` into focused single-responsibility services (`PointsService`, `StreakService`, `SocialService`, `GamificationService`). The `AchievementService` and `ChallengeService` were written for this new architecture but left disabled — they were incomplete in integration, not broken in logic.

**Conclusion: The disable was a mid-migration stall, not a deliberate architectural decision to remove this functionality.**

---

## 3. Feature Coverage Diff

### 3.1 Achievement Logic

| Feature | `gamificationService.ts` (legacy) | `AchievementService.ts.disabled` | `AchievementTracker.ts` |
|---------|----------------------------------|----------------------------------|-------------------------|
| Check all active achievements | ✅ `checkAchievements()` | ✅ `checkAndAwardAchievements()` | ✅ (per-event only) |
| Requirement schema validation (Zod) | ❌ `JSON.parse()` only | ✅ `achievementRequirementSchema.parse()` | ❌ none |
| Duplicate prevention | ✅ `findUnique(userId_achievementId)` | ✅ `rewardHistory` table (stronger dedup) | ✅ `findFirst()` |
| Transactional award (atomic) | ❌ separate await calls | ✅ `prisma.$transaction()` | ❌ separate awaits |
| SOCIAL category: follow-count | ❌ only invites | ✅ `userFollow.count` | ❌ not present |
| SPECIAL category: manual-only | ❌ not differentiated | ✅ returns false explicitly | ❌ not present |
| `getUserAchievements()` with full join | ❌ raw include | ✅ typed return with `unlockedAt` | ✅ raw include |
| Points via PointsService (typed) | ❌ own `awardPoints()` call | ✅ delegates to `pointsService.awardPoints()` | via `RewardEngine` |

**Missing in active system that disabled file has:**
- Zod schema validation on requirement JSON (prevents silent failures on corrupt DB data)
- `rewardHistory` table dedup (stronger: composite `userId_rewardType_rewardId` key prevents double-award across service restarts)
- Full `$transaction()` atomicity in `awardAchievement()` 
- Social achievement: follow-count (`userFollow.count`)
- SPECIAL category short-circuit

### 3.2 Challenge Logic

| Feature | `gamificationService.ts` (legacy) | `ChallengeService.ts.disabled` |
|---------|----------------------------------|-------------------------------|
| Date-bounded active challenges | ✅ | ✅ |
| `updateChallengeProgress()` with upsert | ✅ | ✅ (with `incrementBy` param) |
| Requirement schema validation (Zod) | ❌ | ✅ `challengeRequirementSchema.parse()` |
| `completeChallenge()` dedup via rewardHistory | ❌ (no dedup) | ✅ `rewardHistory` table |
| `completeChallenge()` checks expiry | ❌ | ✅ `ChallengeExpiredError` |
| `getUserChallenges()` with progress + target | ❌ (raw include) | ✅ typed return with `target` from requirement |
| `getActiveChallenges()` for browsing | ❌ not present | ✅ |
| Transactional `completeChallenge()` | ❌ | ✅ `prisma.$transaction()` |

**Missing in active system that disabled file has:**
- Zod schema validation on challenge requirement JSON
- `rewardHistory` dedup on challenge completion (no double-award)
- Expiry check on `completeChallenge()` 
- `getActiveChallenges()` — public browsing endpoint
- Typed `getUserChallenges()` return (includes `target` from parsed requirement)

---

## 4. Decision: Port-Then-Delete

**Rationale:**

1. **The disabled files are not superseded** — they are strictly superior to the legacy code for every feature they implement. They have stronger type safety (Zod), stronger dedup (rewardHistory), and transactional atomicity.

2. **The legacy `gamificationService.ts` is architecturally deprecated** by the new `gamification/` folder split. The new `GamificationService.ts` is the correct integration point.

3. **`AchievementTracker.ts` has a different role** — it is event-driven (called per specific event like group creation, referral) and uses `RewardEngine` for reward delivery. The `AchievementService.ts.disabled` is a general checker (scans all achievements at any trigger point). Both are needed and complementary. The disabled file feeds into `GamificationService`, not `AchievementTracker`.

4. **No unique logic is lost** — the disabled files' unique logic (Zod validation, rewardHistory dedup, `getActiveChallenges`, follow-count social achievements) is being ported into the live system.

5. **Deleting without porting would regress the system** — specifically it would lose: schema-validated requirements, `rewardHistory` dedup, transactional atomicity, follow achievements, and `getActiveChallenges()`.

**Action taken:**
- Ported `AchievementService.ts.disabled` content directly into `backend/src/services/gamification/AchievementService.ts` (new, non-disabled file).
- Ported `ChallengeService.ts.disabled` content into `backend/src/services/gamification/ChallengeService.ts`.
- Wired both services into `GamificationService.ts` (removed all `// Temporarily disabled` comments).
- Updated `SocialService.ts` to call `challengeService.updateChallengeProgress` on follow.
- Deleted both `.disabled` files.
- Added test coverage for ported logic.

---

## 5. Confirmation: No Logic Lost

After porting:

| Unique feature from disabled files | Ported? |
|-------------------------------------|---------|
| Zod achievement requirement schema | ✅ |
| Zod challenge requirement schema | ✅ |
| `rewardHistory` dedup for achievements | ✅ |
| `rewardHistory` dedup for challenges | ✅ |
| `awardAchievement()` in `$transaction()` | ✅ |
| `completeChallenge()` in `$transaction()` | ✅ |
| Follow-count social achievement | ✅ |
| SPECIAL category explicit false return | ✅ |
| `getActiveChallenges()` public method | ✅ |
| Typed `getUserChallenges()` with target | ✅ |
| `updateChallengeProgress()` with `incrementBy` param | ✅ |
| `ChallengeExpiredError` on late completion | ✅ |
