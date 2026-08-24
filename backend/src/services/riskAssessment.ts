import { SorobanService } from './sorobanService'
import * as StellarSdk from 'stellar-sdk'

export interface RiskProfile {
  score: number // 0-100, where 100 is lowest risk
  rating: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  factors: string[]
}

export class RiskAssessmentService {
  private sorobanService: SorobanService

  constructor() {
    this.sorobanService = new SorobanService()
  }

  /**
   * Retrieves the quantitative risk profile for a specific network member.
   * Calls the Soroban contract to obtain the underlying risk score.
   * 
   * @param publicKey - The Stellar public key of the member
   * @returns Promise resolving to the calculated RiskProfile
   */
  async getMemberRiskProfile(publicKey: string): Promise<RiskProfile> {
    const args = [new StellarSdk.Address(publicKey).toScVal()]
    const score = await (this.sorobanService as any).simulateView('get_member_risk_score', args)
    
    const numericScore = Number(score ? this.scValToNumber(score) : 100)
    
    return {
      score: numericScore,
      rating: this.getRatingFromScore(numericScore),
      factors: this.getFactorsFromScore(numericScore),
    }
  }

  /**
   * Retrieves the combined risk profile for an entire savings group.
   * 
   * @param groupId - The unique ID of the group
   * @returns Promise resolving to the calculated RiskProfile
   */
  async getGroupRiskProfile(groupId: string): Promise<RiskProfile> {
    const args = [StellarSdk.nativeToScVal(BigInt(groupId), { type: 'u64' })]
    const score = await (this.sorobanService as any).simulateView('get_group_risk_rating', args)
    
    const numericScore = Number(score ? this.scValToNumber(score) : 75)
    
    return {
      score: numericScore,
      rating: this.getRatingFromScore(numericScore),
      factors: this.getFactorsFromScore(numericScore),
    }
  }

  /**
   * Calculates a dynamic insurance premium based on the base amount and risk score.
   * Adjusts the rate from 0.5% to 2% based on risk thresholds.
   * 
   * @param baseAmount - The base contribution or payout amount (in stroops)
   * @param riskScore - The numeric risk score (0-100)
   * @returns The calculated premium amount as a string
   */
  calculateDynamicPremium(baseAmount: string, riskScore: number): string {
    const amount = BigInt(baseAmount)
    // Example logic: higher risk score (lower numeric value) increases premium
    // Base rate is 1% (100 bps)
    let rateBps = 100
    
    if (riskScore < 50) {
      rateBps = 200 // 2% for high risk
    } else if (riskScore < 75) {
      rateBps = 150 // 1.5% for medium-high risk
    } else if (riskScore >= 95) {
      rateBps = 50 // 0.5% for very low risk
    }

    return ((amount * BigInt(rateBps)) / 10000n).toString()
  }

  private getRatingFromScore(score: number): RiskProfile['rating'] {
    if (score >= 85) return 'LOW'
    if (score >= 60) return 'MEDIUM'
    if (score >= 30) return 'HIGH'
    return 'CRITICAL'
  }

  private getFactorsFromScore(score: number): string[] {
    const factors = []
    if (score >= 90) factors.push('Excellent payment history')
    if (score < 60) factors.push('Frequent late contributions')
    if (score < 40) factors.push('Prior defaults recorded')
    if (factors.length === 0) factors.push('Baseline group performance')
    return factors
  }

  private scValToNumber(val: StellarSdk.xdr.ScVal): number {
    switch (val.switch().name) {
      case 'scvU32':
        return val.u32()
      case 'scvI32':
        return val.i32()
      case 'scvU64':
        return Number(val.u64().toBigInt())
      default:
        return 0
    }
  }
}

export const riskAssessmentService = new RiskAssessmentService()