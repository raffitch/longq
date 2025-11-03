import { useSyncExternalStore } from "react";
import {
  addThresholdLimitListener,
  addThresholdMaxListener,
  addVisibleSeveritiesListener,
  getThresholdLimit,
  getThresholdMax,
  getVisibleSeverities,
} from "../shared/thresholdConfig";

const getLimitSnapshot = () => getThresholdLimit();
const getMaxSnapshot = () => getThresholdMax();
const getVisibleSnapshot = () => getVisibleSeverities();

const subscribeLimit = (callback: () => void) => addThresholdLimitListener(callback);
const subscribeMax = (callback: () => void) => addThresholdMaxListener(callback);
const subscribeVisible = (callback: () => void) => addVisibleSeveritiesListener(callback);

export const useThresholdLimitValue = () =>
  useSyncExternalStore(subscribeLimit, getLimitSnapshot, getLimitSnapshot);

export const useThresholdMaxValue = () =>
  useSyncExternalStore(subscribeMax, getMaxSnapshot, getMaxSnapshot);

export const useVisibleSeverities = () =>
  useSyncExternalStore(subscribeVisible, getVisibleSnapshot, getVisibleSnapshot);
