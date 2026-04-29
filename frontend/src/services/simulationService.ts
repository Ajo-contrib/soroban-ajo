import { TransactionSimulator, SimulationResult } from './transactionSimulator';

export interface SimulationPreview {
  estimatedFee: string;
  feeXLM: number;
  outcome: 'success' | 'failure' | 'warning';
  outcomeMessage: string;
  stateChanges: Array<{ key: string; description: string }>;
  warnings: string[];
}

export class SimulationService {
  private simulator: TransactionSimulator;

  constructor(rpcUrl: string) {
    this.simulator = new TransactionSimulator(rpcUrl);
  }

  async preview(xdr: string): Promise<SimulationPreview> {
    const result: SimulationResult = await this.simulator.simulateTransaction(xdr);

    if (!result.success) {
      return {
        estimatedFee: '0',
        feeXLM: 0,
        outcome: 'failure',
        outcomeMessage: result.error ?? 'Transaction would fail',
        stateChanges: [],
        warnings: [],
      };
    }

    const feeStroops = parseInt(result.estimatedFee, 10) || 0;
    const feeXLM = feeStroops / 1e7;

    const stateChanges = result.stateChanges.map((c) => ({
      key: c.key,
      description: `${c.type}: ${c.key}`,
    }));

    const warnings = result.warnings ?? [];
    const outcome = warnings.length > 0 ? 'warning' : 'success';

    return {
      estimatedFee: result.estimatedFee,
      feeXLM,
      outcome,
      outcomeMessage: outcome === 'success' ? 'Transaction will succeed' : warnings[0],
      stateChanges,
      warnings,
    };
  }
}
