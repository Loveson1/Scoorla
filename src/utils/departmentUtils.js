const DEFAULT_DEPARTMENT_TEMPLATES = [
  { slotId: "department_1", defaultName: "Art" },
  { slotId: "department_2", defaultName: "Science" },
  { slotId: "department_3", defaultName: "Commercial" },
];

const SENIOR_CLASS_KEY_BY_TOKEN = {
  ss1: "SS1",
  sss1: "SS1",
  ss2: "SS2",
  sss2: "SS2",
  ss3: "SS3",
  sss3: "SS3",
};

const CLASS_ID_BY_SENIOR_KEY = {
  SS1: "sss1",
  SS2: "sss2",
  SS3: "sss3",
};

const CLASS_LABELS = {
  jss1: "JSS 1",
  jss2: "JSS 2",
  jss3: "JSS 3",
  sss1: "SSS 1",
  sss2: "SSS 2",
  sss3: "SSS 3",
};

const DEFAULT_GENERAL_SUBJECT_ALIASES = [
  ["math", "mathematics"],
  ["english", "english language"],
  ["civic", "civic education"],
];

const normalizeWhitespace = (value) =>
  String(value || "").replace(/\s+/g, " ").trim();

const normalizeSubjectToken = (value) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");

const normalizeClassToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeDepartmentToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const slugifyDashboardSegment = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const uniqueStrings = (values = []) =>
  [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];

const findCanonicalSubjectLabel = (seniorSubjects = [], aliases = []) => {
  const aliasTokens = new Set(
    (aliases || []).map((item) => normalizeSubjectToken(item)).filter(Boolean)
  );
  return (
    (seniorSubjects || []).find((subject) =>
      aliasTokens.has(normalizeSubjectToken(subject))
    ) || ""
  );
};

const buildDefaultDepartmentSubjects = (seniorSubjects = []) =>
  uniqueStrings(
    DEFAULT_GENERAL_SUBJECT_ALIASES.map((aliases) =>
      findCanonicalSubjectLabel(seniorSubjects, aliases)
    ).filter(Boolean)
  );

const coerceDepartmentSubjects = (subjects = [], seniorSubjects = []) => {
  const catalog = uniqueStrings(seniorSubjects);
  if (catalog.length === 0) {
    return uniqueStrings(subjects);
  }

  return uniqueStrings(subjects)
    .map((subject) => {
      const subjectToken = normalizeSubjectToken(subject);
      return (
        catalog.find(
          (catalogSubject) => normalizeSubjectToken(catalogSubject) === subjectToken
        ) || ""
      );
    })
    .filter(Boolean);
};

const getRawClassStructureConfig = (classStructure = {}, seniorKey = "") => {
  if (!seniorKey) return null;
  return (
    classStructure?.[seniorKey] ||
    classStructure?.[CLASS_ID_BY_SENIOR_KEY[seniorKey]] ||
    classStructure?.[String(seniorKey || "").toLowerCase()] ||
    null
  );
};

const buildTemplateDepartment = (template, seniorSubjects = []) => ({
  id: template.slotId,
  name: template.defaultName,
  subjects: buildDefaultDepartmentSubjects(seniorSubjects),
});

export const getDefaultClassStructure = ({ seniorSubjects = [] } = {}) =>
  ["SS1", "SS2", "SS3"].reduce((acc, seniorKey) => {
    acc[seniorKey] = {
      hasDepartments: false,
      departments: DEFAULT_DEPARTMENT_TEMPLATES.map((template) =>
        buildTemplateDepartment(template, seniorSubjects)
      ),
      mergeGeneralSubjects: false,
    };
    return acc;
  }, {});

export const normalizeClassStructure = (
  classStructure = {},
  { seniorSubjects = [] } = {}
) => {
  const fallback = getDefaultClassStructure({ seniorSubjects });

  return ["SS1", "SS2", "SS3"].reduce((acc, seniorKey) => {
    const rawConfig = getRawClassStructureConfig(classStructure, seniorKey) || {};
    const rawDepartments = Array.isArray(rawConfig?.departments)
      ? rawConfig.departments
      : [];
    const departmentCount = Math.max(
      2,
      Math.min(3, Number(rawDepartments.length || fallback[seniorKey].departments.length) || 3)
    );

    const departments = DEFAULT_DEPARTMENT_TEMPLATES.slice(0, departmentCount).map(
      (template, index) => {
        const rawDepartment = rawDepartments[index] || {};
        const normalizedSubjects = coerceDepartmentSubjects(
          rawDepartment?.subjects || [],
          seniorSubjects
        );

        return {
          id:
            normalizeDepartmentToken(rawDepartment?.id) || template.slotId,
          name:
            normalizeWhitespace(rawDepartment?.name) || template.defaultName,
          subjects:
            normalizedSubjects.length > 0
              ? normalizedSubjects
              : buildTemplateDepartment(template, seniorSubjects).subjects,
        };
      }
    );

    acc[seniorKey] = {
      hasDepartments: rawConfig?.hasDepartments === true,
      departments,
      mergeGeneralSubjects: rawConfig?.mergeGeneralSubjects === true,
    };
    return acc;
  }, { ...fallback });
};

export const getSeniorDepartmentClassKey = (classId = "") =>
  SENIOR_CLASS_KEY_BY_TOKEN[normalizeClassToken(classId)] || "";

export const getClassIdFromRouteSegment = (segment = "") => {
  const normalized = normalizeClassToken(segment);
  if (normalized === "ss1" || normalized === "sss1") return "sss1";
  if (normalized === "ss2" || normalized === "sss2") return "sss2";
  if (normalized === "ss3" || normalized === "sss3") return "sss3";
  if (normalized === "jss1") return "jss1";
  if (normalized === "jss2") return "jss2";
  if (normalized === "jss3") return "jss3";
  return String(segment || "").trim().toLowerCase().replace(/\s+/g, "");
};

export const getClassRouteSegment = (classId = "") => {
  const seniorKey = getSeniorDepartmentClassKey(classId);
  if (seniorKey) return seniorKey;
  return String(classId || "").trim().toUpperCase().replace(/\s+/g, "");
};

export const formatClassLabel = (classId = "") =>
  CLASS_LABELS[normalizeClassToken(classId)] || classId || "Not set";

export const getClassStructureConfig = (classStructure = {}, classId = "") => {
  const seniorKey = getSeniorDepartmentClassKey(classId);
  if (!seniorKey) {
    return {
      hasDepartments: false,
      departments: [],
      mergeGeneralSubjects: false,
    };
  }

  const normalized = normalizeClassStructure(classStructure);
  return normalized?.[seniorKey] || {
    hasDepartments: false,
    departments: [],
    mergeGeneralSubjects: false,
  };
};

export const getDepartmentsForClass = (classStructure = {}, classId = "") => {
  const classConfig = getClassStructureConfig(classStructure, classId);
  return classConfig?.hasDepartments ? classConfig.departments || [] : [];
};

export const getDepartmentById = (
  classStructure = {},
  classId = "",
  departmentId = ""
) => {
  const normalizedDepartmentId = normalizeDepartmentToken(departmentId);
  if (!normalizedDepartmentId) return null;
  return (
    getDepartmentsForClass(classStructure, classId).find(
      (department) => normalizeDepartmentToken(department?.id) === normalizedDepartmentId
    ) || null
  );
};

export const getDepartmentRouteSlug = (department = null) =>
  slugifyDashboardSegment(department?.name || department?.id || "");

export const resolveDepartmentFromRoute = (
  classStructure = {},
  classId = "",
  routeSegment = ""
) => {
  const departments = getDepartmentsForClass(classStructure, classId);
  const normalizedRouteSlug = slugifyDashboardSegment(routeSegment);
  if (!normalizedRouteSlug) return null;

  return (
    departments.find((department) => {
      const departmentTokens = new Set([
        normalizeDepartmentToken(department?.id),
        normalizeDepartmentToken(department?.name),
        slugifyDashboardSegment(department?.name),
      ]);
      return departmentTokens.has(normalizedRouteSlug.replace(/-/g, "_")) ||
        departmentTokens.has(normalizedRouteSlug);
    }) || null
  );
};

export const getDepartmentSubjectOptions = (
  classStructure = {},
  classId = "",
  departmentId = "",
  fallbackSubjects = []
) => {
  const departments = getDepartmentsForClass(classStructure, classId);
  if (departments.length === 0) {
    return uniqueStrings(fallbackSubjects);
  }

  if (!departmentId) {
    return uniqueStrings(
      departments.flatMap((department) => department?.subjects || [])
    );
  }

  const department = getDepartmentById(classStructure, classId, departmentId);
  return uniqueStrings(department?.subjects || []);
};

export const isMergedDepartmentSubject = (
  classStructure = {},
  classId = "",
  subjectId = ""
) => {
  const classConfig = getClassStructureConfig(classStructure, classId);
  const departments = classConfig?.departments || [];
  if (!classConfig?.hasDepartments || !classConfig?.mergeGeneralSubjects || departments.length === 0) {
    return false;
  }

  const subjectToken = normalizeSubjectToken(subjectId);
  if (!subjectToken) return false;

  return departments.every((department) =>
    (department?.subjects || []).some(
      (subject) => normalizeSubjectToken(subject) === subjectToken
    )
  );
};

export const getDepartmentScopeMeta = (
  classStructure = {},
  classId = "",
  departmentId = "",
  subjectId = ""
) => {
  const classConfig = getClassStructureConfig(classStructure, classId);
  const department = getDepartmentById(classStructure, classId, departmentId);
  const hasDepartments = classConfig?.hasDepartments && !!department;
  const isMergedSubject =
    hasDepartments && isMergedDepartmentSubject(classStructure, classId, subjectId);

  return {
    hasDepartments,
    department,
    isMergedSubject,
    usesDepartmentFilter: hasDepartments && !isMergedSubject,
  };
};

const studentMatchesDepartment = (student = {}, department = null) => {
  if (!department) return true;
  const departmentTokens = new Set([
    normalizeDepartmentToken(department?.id),
    normalizeDepartmentToken(department?.name),
  ]);
  const studentTokens = [
    normalizeDepartmentToken(student?.departmentId),
    normalizeDepartmentToken(student?.departmentName),
  ].filter(Boolean);
  return studentTokens.some((token) => departmentTokens.has(token));
};

export const filterStudentsByDepartmentScope = (
  students = [],
  classStructure = {},
  classId = "",
  { departmentId = "", subjectId = "" } = {}
) => {
  const scopeMeta = getDepartmentScopeMeta(
    classStructure,
    classId,
    departmentId,
    subjectId
  );
  if (!scopeMeta.usesDepartmentFilter) {
    return Array.isArray(students) ? students : [];
  }

  return (Array.isArray(students) ? students : []).filter((student) =>
    studentMatchesDepartment(student, scopeMeta.department)
  );
};

const getSubjectRouteAliases = (subject = "") => {
  const subjectToken = normalizeSubjectToken(subject);
  const aliases = new Set([
    slugifyDashboardSegment(subject),
    subjectToken.replace(/_/g, "-"),
  ]);

  if (subjectToken === "mathematics") {
    aliases.add("math");
  }
  if (subjectToken === "english_language") {
    aliases.add("english");
  }
  if (subjectToken === "civic_education") {
    aliases.add("civic");
  }

  return [...aliases].filter(Boolean);
};

export const getSubjectRouteSlug = (subject = "") =>
  getSubjectRouteAliases(subject)[0] || slugifyDashboardSegment(subject);

export const resolveSubjectFromRouteSegment = (subjects = [], routeSegment = "") => {
  const normalizedRouteSegment = slugifyDashboardSegment(routeSegment);
  if (!normalizedRouteSegment) return "";

  return (
    uniqueStrings(subjects).find((subject) =>
      getSubjectRouteAliases(subject).includes(normalizedRouteSegment)
    ) || ""
  );
};

export const buildClassDashboardPath = ({
  classId = "",
  departmentId = "",
  classStructure = {},
} = {}) => {
  const classSegment = getClassRouteSegment(classId);
  if (!classSegment) return "/class-dashboard";

  const department = getDepartmentById(classStructure, classId, departmentId);
  if (!department) {
    return `/dashboard/class/${encodeURIComponent(classSegment)}`;
  }

  return `/dashboard/class/${encodeURIComponent(classSegment)}/${encodeURIComponent(
    getDepartmentRouteSlug(department)
  )}`;
};

export const buildRecordDashboardPath = ({
  classId = "",
  departmentId = "",
  subjectId = "",
  classStructure = {},
} = {}) => {
  const classSegment = getClassRouteSegment(classId);
  const subjectSegment = getSubjectRouteSlug(subjectId);
  if (!classSegment || !subjectSegment) {
    return "/record-dashboard";
  }

  const department = getDepartmentById(classStructure, classId, departmentId);
  if (!department) {
    return `/dashboard/record/${encodeURIComponent(classSegment)}/${encodeURIComponent(
      subjectSegment
    )}`;
  }

  return `/dashboard/record/${encodeURIComponent(classSegment)}/${encodeURIComponent(
    getDepartmentRouteSlug(department)
  )}/${encodeURIComponent(subjectSegment)}`;
};

export const formatScopedClassLabel = (classId = "", departmentName = "") => {
  const classLabel = formatClassLabel(classId);
  const normalizedDepartmentName = normalizeWhitespace(departmentName);
  return normalizedDepartmentName
    ? `${classLabel} - ${normalizedDepartmentName}`
    : classLabel;
};
