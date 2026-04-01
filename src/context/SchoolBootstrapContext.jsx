/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getAdminSettings, getSchoolData } from "../components/utils/school-data";
import { useAuthContext } from "./AuthContext";
import {
  SCHOOL_PROFILE_UPDATED_EVENT,
  SCHOOL_SETTINGS_UPDATED_EVENT,
} from "../utils/appEvents";

const SchoolBootstrapContext = createContext(null);

export function SchoolBootstrapProvider({ children }) {
  const { authUser, schoolId, isLoading: isAuthLoading } = useAuthContext();
  const [schoolData, setSchoolData] = useState({});
  const [adminSettings, setAdminSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSchoolData = useCallback(
    async (targetSchoolId = schoolId) => {
      if (!targetSchoolId) {
        setSchoolData({});
        return {};
      }
      const nextSchoolData = (await getSchoolData(targetSchoolId)) || {};
      setSchoolData(nextSchoolData);
      return nextSchoolData;
    },
    [schoolId]
  );

  const refreshAdminSettings = useCallback(
    async (targetSchoolId = schoolId) => {
      if (!targetSchoolId) {
        setAdminSettings(null);
        return null;
      }
      const nextSettings = (await getAdminSettings(targetSchoolId)) || null;
      setAdminSettings(nextSettings);
      return nextSettings;
    },
    [schoolId]
  );

  const refreshBootstrap = useCallback(
    async (targetSchoolId = schoolId) => {
      if (!targetSchoolId) {
        setSchoolData({});
        setAdminSettings(null);
        return { schoolData: {}, adminSettings: null };
      }
      const [nextSchoolData, nextAdminSettings] = await Promise.all([
        getSchoolData(targetSchoolId),
        getAdminSettings(targetSchoolId),
      ]);
      setSchoolData(nextSchoolData || {});
      setAdminSettings(nextAdminSettings || null);
      return {
        schoolData: nextSchoolData || {},
        adminSettings: nextAdminSettings || null,
      };
    },
    [schoolId]
  );

  useEffect(() => {
    let isMounted = true;

    const loadBootstrap = async () => {
      if (isAuthLoading) {
        if (isMounted) setIsLoading(true);
        return;
      }

      if (!authUser?.uid || !schoolId) {
        if (!isMounted) return;
        setSchoolData({});
        setAdminSettings(null);
        setIsLoading(false);
        return;
      }

      if (isMounted) setIsLoading(true);
      try {
        const [nextSchoolData, nextAdminSettings] = await Promise.all([
          getSchoolData(schoolId),
          getAdminSettings(schoolId),
        ]);
        if (!isMounted) return;
        setSchoolData(nextSchoolData || {});
        setAdminSettings(nextAdminSettings || null);
      } catch (error) {
        console.error("Error loading school bootstrap data:", error);
        if (!isMounted) return;
        setSchoolData({});
        setAdminSettings(null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadBootstrap();

    return () => {
      isMounted = false;
    };
  }, [authUser?.uid, schoolId, isAuthLoading]);

  useEffect(() => {
    if (!schoolId) return undefined;

    const handleSchoolProfileUpdated = async (event) => {
      const targetSchoolId = String(event?.detail?.schoolId || "").trim();
      if (targetSchoolId && targetSchoolId !== String(schoolId)) {
        return;
      }
      if (event?.detail?.schoolData) {
        setSchoolData((prev) => ({
          ...(prev || {}),
          ...(event.detail.schoolData || {}),
        }));
        return;
      }
      try {
        await refreshSchoolData(schoolId);
      } catch (error) {
        console.warn("Unable to refresh school profile:", error?.message || error);
      }
    };

    const handleSchoolSettingsUpdated = async (event) => {
      const targetSchoolId = String(event?.detail?.schoolId || "").trim();
      if (targetSchoolId && targetSchoolId !== String(schoolId)) {
        return;
      }
      if (event?.detail?.settings) {
        setAdminSettings(event.detail.settings || null);
        return;
      }
      try {
        await refreshAdminSettings(schoolId);
      } catch (error) {
        console.warn("Unable to refresh school settings:", error?.message || error);
      }
    };

    window.addEventListener(SCHOOL_PROFILE_UPDATED_EVENT, handleSchoolProfileUpdated);
    window.addEventListener(SCHOOL_SETTINGS_UPDATED_EVENT, handleSchoolSettingsUpdated);

    return () => {
      window.removeEventListener(SCHOOL_PROFILE_UPDATED_EVENT, handleSchoolProfileUpdated);
      window.removeEventListener(SCHOOL_SETTINGS_UPDATED_EVENT, handleSchoolSettingsUpdated);
    };
  }, [schoolId, refreshAdminSettings, refreshSchoolData]);

  const value = useMemo(
    () => ({
      schoolId: schoolId || null,
      schoolData,
      adminSettings,
      isLoading,
      refreshSchoolData,
      refreshAdminSettings,
      refreshBootstrap,
    }),
    [
      schoolId,
      schoolData,
      adminSettings,
      isLoading,
      refreshSchoolData,
      refreshAdminSettings,
      refreshBootstrap,
    ]
  );

  return (
    <SchoolBootstrapContext.Provider value={value}>
      {children}
    </SchoolBootstrapContext.Provider>
  );
}

export function useSchoolBootstrap() {
  const context = useContext(SchoolBootstrapContext);
  if (!context) {
    throw new Error("useSchoolBootstrap must be used within SchoolBootstrapProvider");
  }
  return context;
}
