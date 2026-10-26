export interface ChatCompaction {
  id: string | null;
  status: 'running' | 'completed' | 'failed';
  summary: string;
  throughSeq: number;
  coveredTurns: number;
  olderTurns: number;
  remainingTurns: number;
  sourceHash: string;
  truncatedTurnIds: string[];
  error?: string;
}
