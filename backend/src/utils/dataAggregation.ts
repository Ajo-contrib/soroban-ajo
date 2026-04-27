export class DataAggregation {
  static groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((result, item) => {
      const groupKey = String(item[key]);
      if (!result[groupKey]) {
        result[groupKey] = [];
      }
      result[groupKey].push(item);
      return result;
    }, {} as Record<string, T[]>);
  }

  static sum(array: number[]): number {
    return array.reduce((acc, val) => acc + val, 0);
  }

  static average(array: number[]): number {
    return array.length > 0 ? this.sum(array) / array.length : 0;
  }

  static median(array: number[]): number {
    const sorted = [...array].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  static percentile(array: number[], p: number): number {
    const sorted = [...array].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  static standardDeviation(array: number[]): number {
    const avg = this.average(array);
    const squareDiffs = array.map(value => Math.pow(value - avg, 2));
    return Math.sqrt(this.average(squareDiffs));
  }

  static movingAverage(array: number[], window: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < array.length; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = array.slice(start, i + 1);
      result.push(this.average(slice));
    }
    return result;
  }

  static trendAnalysis(data: number[]): { slope: number; direction: string } {
    const n = data.length;
    const xSum = (n * (n - 1)) / 2;
    const ySum = this.sum(data);
    const xySum = data.reduce((sum, y, x) => sum + x * y, 0);
    const xSquareSum = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * xySum - xSum * ySum) / (n * xSquareSum - xSum * xSum);
    const direction = slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'stable';

    return { slope, direction };
  }
}
