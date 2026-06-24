import { create } from "zustand";

// Portal product-tour state. Pure UI; no server interaction.
//
// Token-scoped so dismissing the tour on one portal doesn't
// suppress it on another. localStorage write happens in the
// TourProvider (this store stays storage-free so SSR is safe).

export type TourStore = {
  active: boolean;
  step: number;
  totalSteps: number;
  start: () => void;
  next: () => void;
  skip: () => void;
  setTotalSteps: (n: number) => void;
};

export const useTourStore = create<TourStore>((set, get) => ({
  active: false,
  step: 0,
  totalSteps: 0,
  start: () => set({ active: true, step: 0 }),
  next: () => {
    const { step, totalSteps } = get();
    if (step + 1 >= totalSteps) {
      set({ active: false, step: 0 });
    } else {
      set({ step: step + 1 });
    }
  },
  skip: () => set({ active: false, step: 0 }),
  setTotalSteps: (n) => set({ totalSteps: n }),
}));
