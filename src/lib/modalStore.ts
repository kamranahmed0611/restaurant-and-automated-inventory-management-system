import { create } from 'zustand';

export type ModalType = 'success' | 'error' | 'warning' | 'info' | 'confirm';

export interface DialogOptions {
  title?: string;
  message: string;
  type?: ModalType;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
}

interface ModalStore {
  dialog: {
    isOpen: boolean;
    title: string;
    message: string;
    type: ModalType;
    confirmText: string;
    cancelText?: string;
    isDanger: boolean;
    resolve: ((val: boolean) => void) | null;
  };
  toasts: ToastItem[];
  openDialog: (opts: DialogOptions) => Promise<boolean>;
  closeDialog: (confirmed: boolean) => void;
  addToast: (t: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useModalStore = create<ModalStore>((set, get) => ({
  dialog: {
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
    confirmText: 'Got It',
    cancelText: undefined,
    isDanger: false,
    resolve: null,
  },
  toasts: [],

  openDialog: (opts: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      set({
        dialog: {
          isOpen: true,
          title: opts.title || (opts.type === 'error' ? 'Action Failed' : opts.type === 'success' ? 'Success' : opts.type === 'warning' ? 'Notice' : opts.type === 'confirm' ? 'Please Confirm' : 'Information'),
          message: opts.message,
          type: opts.type || (opts.cancelText ? 'confirm' : 'info'),
          confirmText: opts.confirmText || (opts.cancelText ? 'Confirm' : 'Got It'),
          cancelText: opts.cancelText,
          isDanger: opts.isDanger || false,
          resolve,
        },
      });
    });
  },

  closeDialog: (confirmed: boolean) => {
    const { resolve } = get().dialog;
    if (resolve) resolve(confirmed);
    set((state) => ({
      dialog: {
        ...state.dialog,
        isOpen: false,
        resolve: null,
      },
    }));
  },

  addToast: (t) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastItem = { ...t, id };
    set((state) => ({ toasts: [...state.toasts, newToast] }));
    const dur = t.duration || 3500;
    setTimeout(() => {
      get().removeToast(id);
    }, dur);
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/**
 * Universal Drop-in Modal & Alert API
 * Can be called anywhere (inside components or async handlers)
 */
export const modal = {
  alert: (opts: DialogOptions | string) => {
    const options: DialogOptions = typeof opts === 'string' ? { message: opts, type: 'info' } : opts;
    return useModalStore.getState().openDialog(options);
  },

  success: (titleOrMessage: string, message?: string) => {
    return useModalStore.getState().openDialog({
      title: message ? titleOrMessage : 'Success',
      message: message || titleOrMessage,
      type: 'success',
      confirmText: 'Done',
    });
  },

  error: (titleOrMessage: string, message?: string) => {
    return useModalStore.getState().openDialog({
      title: message ? titleOrMessage : 'Action Failed',
      message: message || titleOrMessage,
      type: 'error',
      confirmText: 'Dismiss',
    });
  },

  warning: (titleOrMessage: string, message?: string) => {
    return useModalStore.getState().openDialog({
      title: message ? titleOrMessage : 'Attention Needed',
      message: message || titleOrMessage,
      type: 'warning',
      confirmText: 'Understood',
    });
  },

  confirm: (opts: { title?: string; message: string; confirmText?: string; cancelText?: string; isDanger?: boolean } | string) => {
    if (typeof opts === 'string') {
      return useModalStore.getState().openDialog({
        title: 'Please Confirm',
        message: opts,
        type: 'confirm',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
      });
    }
    return useModalStore.getState().openDialog({
      title: opts.title || 'Please Confirm',
      message: opts.message,
      type: 'confirm',
      confirmText: opts.confirmText || (opts.isDanger ? 'Delete' : 'Confirm'),
      cancelText: opts.cancelText || 'Cancel',
      isDanger: opts.isDanger,
    });
  },

  toast: {
    success: (message: string, title?: string) => {
      useModalStore.getState().addToast({ type: 'success', message, title });
    },
    error: (message: string, title?: string) => {
      useModalStore.getState().addToast({ type: 'error', message, title, duration: 4500 });
    },
    warning: (message: string, title?: string) => {
      useModalStore.getState().addToast({ type: 'warning', message, title });
    },
    info: (message: string, title?: string) => {
      useModalStore.getState().addToast({ type: 'info', message, title });
    },
  },
};
