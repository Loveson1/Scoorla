export const SCHOOL_PROFILE_UPDATED_EVENT = "school-profile-updated";
export const SCHOOL_SETTINGS_UPDATED_EVENT = "school-settings-updated";

export const dispatchSchoolProfileUpdated = (detail = {}) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SCHOOL_PROFILE_UPDATED_EVENT, {
      detail,
    })
  );
};

export const dispatchSchoolSettingsUpdated = (detail = {}) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SCHOOL_SETTINGS_UPDATED_EVENT, {
      detail,
    })
  );
};
