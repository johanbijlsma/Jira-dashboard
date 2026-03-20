import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./dashboard-constants";
import { usePageVisibility } from "./use-page-visibility";

export function useVacationsData() {
  const [upcomingVacations, setUpcomingVacations] = useState([]);
  const [upcomingVacationTotal, setUpcomingVacationTotal] = useState(0);
  const [allVacations, setAllVacations] = useState([]);
  const [todayVacations, setTodayVacations] = useState([]);
  const isPageVisible = usePageVisibility();
  const wasPageVisibleRef = useRef(isPageVisible);

  const refreshVacations = useCallback(async () => {
    const [allRes, upcomingRes, todayRes] = await Promise.all([
      fetch(`${API}/vacations`),
      fetch(`${API}/vacations/upcoming?limit=3`),
      fetch(`${API}/vacations/today`),
    ]);
    const [allData, upcomingData, todayData] = await Promise.all([
      allRes.json(),
      upcomingRes.json(),
      todayRes.json(),
    ]);
    setAllVacations(Array.isArray(allData) ? allData : []);
    setUpcomingVacationTotal(Array.isArray(allData) ? allData.length : 0);
    setUpcomingVacations(Array.isArray(upcomingData) ? upcomingData : []);
    setTodayVacations(Array.isArray(todayData) ? todayData : []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshVacations().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshVacations]);

  useEffect(() => {
    let timer = null;
    if (!wasPageVisibleRef.current && isPageVisible) {
      timer = window.setTimeout(() => {
        refreshVacations().catch(() => {});
      }, 0);
    }
    wasPageVisibleRef.current = isPageVisible;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isPageVisible, refreshVacations]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshVacations().catch(() => {});
    }, isPageVisible ? 60000 : 300000);
    return () => clearInterval(timer);
  }, [isPageVisible, refreshVacations]);

  return {
    upcomingVacations,
    upcomingVacationTotal,
    allVacations,
    todayVacations,
    refreshVacations,
  };
}
