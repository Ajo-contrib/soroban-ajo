export interface Contribution {
  id: string;
  groupId: string;
  memberId: string;
  amount: number;
  timestamp: Date;
  onTime: boolean;
}

export interface Payout {
  id: string;
  groupId: string;
  recipientId: string;
  amount: number;
  timestamp: Date;
}

export interface Group {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'completed';
  members: string[];
}

export interface Member {
  id: string;
  name: string;
  email: string;
}
