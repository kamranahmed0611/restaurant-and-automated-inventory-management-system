"use client";

/**
 * Muchachos Cross-Tab & Realtime POS Communication Bus
 * Enables instant 0-millisecond sync across Cashier POS, KDS (Kitchen Display), and Admin tabs.
 */

type BusEventType = 
  | 'ORDER_CREATED' 
  | 'ORDER_UPDATED' 
  | 'ORDER_COMPLETED' 
  | 'ORDER_CANCELLED' 
  | 'KOT_SENT'
  | 'KDS_TOGGLED'
  | 'KDS_DINE_IN_CLEARED'
  | 'MENU_UPDATED'
  | 'CASHIER_PIN_UPDATED'
  | 'OFFLINE_MODE_CHANGED'
  | 'STOCK_UPDATED'
  | 'EXPENSE_LOGGED'
  | 'SHIFT_CLOSED'
  | 'ADMIN_TAB_SELECTED'
  | 'DIAGNOSTICS_REFRESH'
  | 'MANUAL_REFRESH';

interface BusMessage {
  type: BusEventType;
  orderId?: string;
  tokenNumber?: number;
  orderType?: string;
  tableNumber?: string;
  kdsEnabled?: boolean;
  itemCount?: number;
  fullOrder?: any;
  cashierId?: string;
  isExplicitOffline?: boolean;
  itemId?: string;
  newStock?: number;
  amount?: number;
  category?: string;
  categoryId?: string;
  id?: string;
  payload?: any;
  shiftId?: string;
  tab?: string;
  timestamp: number;
}

const CHANNEL_NAME = 'muchachos_realtime_pos_bus';

class RealtimePosBus {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<(msg: BusMessage) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          if (event.data) {
            this.notifyListeners(event.data);
          }
        };
      } catch (err) {
        console.warn('BroadcastChannel not supported or failed to initialize:', err);
      }

      // Also listen to storage events as cross-window fallback
      window.addEventListener('storage', (e) => {
        if (e.key === 'muchachos_last_bus_event' && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            this.notifyListeners(data);
          } catch {}
        }
      });
    }
  }

  public publish(typeOrMsg: BusEventType | { type: BusEventType; [key: string]: any }, details: Partial<Omit<BusMessage, 'type' | 'timestamp'>> = {}) {
    const type = typeof typeOrMsg === 'string' ? typeOrMsg : typeOrMsg.type;
    const extra = typeof typeOrMsg === 'object' ? typeOrMsg : details;
    const msg: BusMessage = {
      ...extra,
      type,
      timestamp: Date.now()
    };

    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch (err) {
        console.warn('Error posting to BroadcastChannel:', err);
      }
    }

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('muchachos_last_bus_event', JSON.stringify(msg));
      } catch {}
    }

    // Also notify listeners in current tab
    this.notifyListeners(msg);
  }

  public subscribe(
    typeOrCallback: BusEventType | ((msg: BusMessage) => void),
    maybeCallback?: (msg: BusMessage) => void
  ): () => void {
    if (typeof typeOrCallback === 'string' && maybeCallback) {
      const filteredCb = (msg: BusMessage) => {
        if (msg.type === typeOrCallback) {
          maybeCallback(msg);
        }
      };
      this.listeners.add(filteredCb);
      return () => {
        this.listeners.delete(filteredCb);
      };
    }
    const cb = typeOrCallback as (msg: BusMessage) => void;
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notifyListeners(msg: BusMessage) {
    this.listeners.forEach(cb => {
      try {
        cb(msg);
      } catch (err) {
        console.error('Error in bus listener:', err);
      }
    });
  }
}

export const posBus = new RealtimePosBus();
