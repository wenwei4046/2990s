import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotificationState {
  ordersReadAt: string | null;
  markOrdersRead: (at: string) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      ordersReadAt: null,
      markOrdersRead: (at) => set({ ordersReadAt: at }),
    }),
    { name: '2990-backend-notifications' },
  ),
);
