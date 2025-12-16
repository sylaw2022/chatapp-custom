export interface User {
  id: number;
  username: string;
  password?: string; // Only needed for auth logic
  role: 'user' | 'admin';
  nickname: string;
  avatar: string;
  isVisible: boolean;
  createdAt: string;
}

export interface Group {
  id: number;
  name: string;
  avatar: string;
  admin_id: number;
  createdAt: string;
}

export interface Message {
  id: number;
  sender_id: number;
  recipient_id?: number | null;
  group_id?: number | null;
  content: string;
  fileUrl?: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'file';
  timestamp: string;
  // Joins
  sender?: User;
}
