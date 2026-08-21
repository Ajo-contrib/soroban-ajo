import { SorobanRpc } from 'stellar-sdk';

export interface SimulationResult {
  success: boolean;
  estimatedFee: string;
  stateChanges: StateChange[];
  error?: string;
  warnings?: string[];
}

export interface StateChange {
  key: string;
  oldValue?: unknown;
  newValue?: unknown;
  type: 'created' | 'updated' | 'deleted';
}

export class TransactionSimulator {
  private rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  async simulateTransaction(xdr: string): Promise<SimulationResult> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'simulateTransaction',
          params: { transaction: xdr },
        }),
      });

      const data = await response.json();

      if (data.error) {
        return {
          success: false,
          estimatedFee: '0',
          stateChanges: [],
          error: data.error.message,
        };
      }

      const result = data.result;
      return {
        success: true,
        estimatedFee: result.latestLedgerBumpSeqNum
          ? String(result.minResourceFee)
          : '0',
        stateChanges: this.extractStateChanges(result),
        warnings: result.events?.filter((e: unknown) => e).map(() => 'Event detected'),
      };
    } catch (error) {
      return {
        success: false,
        estimatedFee: '0',
        stateChanges: [],
        error: error instanceof Error ? error.message : 'Simulation failed',
      };
    }
  }

  private extractStateChanges(result: unknown): StateChange[] {
    const changes: StateChange[] = [];
    if (typeof result === 'object' && result !== null && 'stateChanges' in result) {
      const stateChanges = (result as Record<string, unknown>).stateChanges;
      if (Array.isArray(stateChanges)) {
        stateChanges.forEach((change: unknown) => {
          if (typeof change === 'object' && change !== null) {
            const c = change as Record<string, unknown>;
            changes.push({
              key: String(c.key || ''),
              oldValue: c.oldValue,
              newValue: c.newValue,
              type: (c.type as 'created' | 'updated' | 'deleted') || 'updated',
            });
          }
        });
      }
    }
    return changes;
  }
}
