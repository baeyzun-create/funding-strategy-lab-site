(function () {
  const STATUS_OPTIONS = [
    { value: "new", label: "문의 접수" },
    { value: "materials_received", label: "자료 확인" },
    { value: "analysis", label: "AI 로드맵 생성" },
    { value: "concierge", label: "컨시어지 검토" },
    { value: "estimate", label: "견적 발송" },
    { value: "closed", label: "종료" }
  ];

  let cachedClient = null;
  let cachedKey = "";

  function getConfig() {
    return window.FUNDING_SUPABASE_CONFIG || {};
  }

  function cleanUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function isConfigured() {
    const config = getConfig();
    return Boolean(cleanUrl(config.url) && String(config.anonKey || "").trim());
  }

  function getClient() {
    const config = getConfig();
    const url = cleanUrl(config.url);
    const anonKey = String(config.anonKey || "").trim();
    const key = url + "::" + anonKey;

    if (!url || !anonKey) {
      throw new Error("Supabase URL과 anon key를 assets/supabase-config.js에 입력해주세요.");
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase SDK를 불러오지 못했습니다. 네트워크 연결 또는 CDN 로드를 확인해주세요.");
    }

    if (!cachedClient || cachedKey !== key) {
      cachedClient = window.supabase.createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      cachedKey = key;
    }

    return cachedClient;
  }

  function getTableName(name, fallback) {
    return String(getConfig()[name] || fallback).trim();
  }

  function getMaxFileSizeMb() {
    return Number(getConfig().maxFileSizeMb || 15);
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const value = Math.random() * 16 | 0;
      const next = char === "x" ? value : (value & 0x3 | 0x8);
      return next.toString(16);
    });
  }

  function safeFileName(name) {
    return String(name || "attachment")
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 140) || "attachment";
  }

  function normalizeError(error, fallback) {
    if (!error) {
      return new Error(fallback || "요청을 처리하지 못했습니다.");
    }

    return new Error(error.message || error.error_description || fallback || "요청을 처리하지 못했습니다.");
  }

  function requireFields(fields) {
    const required = [
      ["companyName", "기업명을 입력해주세요."],
      ["contactName", "담당자명을 입력해주세요."],
      ["phone", "연락처를 입력해주세요."],
      ["consultationType", "상담 요청 항목을 선택해주세요."]
    ];

    required.forEach(([key, message]) => {
      if (!String(fields[key] || "").trim()) {
        throw new Error(message);
      }
    });
  }

  function validateFiles(files) {
    const fileList = Array.from(files || []);
    const maxMb = getMaxFileSizeMb();
    const maxBytes = maxMb * 1024 * 1024;

    if (!fileList.length) {
      throw new Error("로드맵 검토를 위해 자료 첨부는 필수입니다.");
    }

    const oversized = fileList.find((file) => file.size > maxBytes);
    if (oversized) {
      throw new Error(oversized.name + " 파일은 " + maxMb + "MB 이하로 첨부해주세요.");
    }

    return fileList;
  }

  async function uploadAttachments(inquiryId, files) {
    const client = getClient();
    const bucket = getTableName("attachmentsBucket", "inquiry-attachments");
    const timestamp = Date.now();
    const uploaded = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const storagePath = [
        inquiryId,
        String(index + 1).padStart(2, "0") + "-" + timestamp + "-" + safeFileName(file.name)
      ].join("/");

      const { data, error } = await client.storage
        .from(bucket)
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: file.type || undefined,
          upsert: false
        });

      if (error) {
        throw normalizeError(error, "첨부파일 업로드에 실패했습니다.");
      }

      uploaded.push({
        name: file.name,
        path: data && data.path ? data.path : storagePath,
        fullPath: data && data.fullPath ? data.fullPath : bucket + "/" + storagePath,
        size: file.size,
        type: file.type || "application/octet-stream",
        uploadedAt: new Date().toISOString()
      });
    }

    return uploaded;
  }

  async function submitRoadmapInquiry(fields) {
    const client = getClient();
    const table = getTableName("inquiriesTable", "roadmap_inquiries");
    const inquiryId = createId();
    const payloadFields = {
      companyName: String(fields.companyName || "").trim(),
      contactName: String(fields.contactName || "").trim(),
      phone: String(fields.phone || "").trim(),
      consultationType: String(fields.consultationType || "").trim(),
      message: String(fields.message || "").trim()
    };
    const files = validateFiles(fields.files);

    requireFields(payloadFields);

    const attachments = await uploadAttachments(inquiryId, files);
    const payload = {
      id: inquiryId,
      company_name: payloadFields.companyName,
      contact_name: payloadFields.contactName,
      phone: payloadFields.phone,
      consultation_type: payloadFields.consultationType,
      message: payloadFields.message,
      status: "new",
      attachment_count: attachments.length,
      attachments,
      source_page: window.location.href,
      user_agent: window.navigator.userAgent
    };

    const { data, error } = await client
      .from(table)
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw normalizeError(error, "문의 정보를 저장하지 못했습니다.");
    }

    return data;
  }

  async function getSession() {
    const { data, error } = await getClient().auth.getSession();

    if (error) {
      throw normalizeError(error, "관리자 세션을 확인하지 못했습니다.");
    }

    return data.session || null;
  }

  async function fetchAdminProfile() {
    const session = await getSession();
    if (!session || !session.user) {
      return null;
    }

    const table = getTableName("adminsTable", "admin_users");
    const { data, error } = await getClient()
      .from(table)
      .select("user_id,email,role")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) {
      throw normalizeError(error, "관리자 권한을 확인하지 못했습니다.");
    }

    return data || null;
  }

  async function signInAdmin(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({
      email: String(email || "").trim(),
      password: String(password || "")
    });

    if (error) {
      throw normalizeError(error, "관리자 로그인에 실패했습니다.");
    }

    const profile = await fetchAdminProfile();
    if (!profile) {
      await signOut();
      throw new Error("관리자 권한이 등록되지 않은 계정입니다.");
    }

    return {
      session: data.session,
      user: data.user,
      profile
    };
  }

  async function signOut() {
    if (!isConfigured()) {
      return;
    }

    await getClient().auth.signOut();
  }

  async function fetchInquiries(options) {
    const table = getTableName("inquiriesTable", "roadmap_inquiries");
    const limit = Number(options && options.limit ? options.limit : 100);
    const { data, error } = await getClient()
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw normalizeError(error, "문의 목록을 불러오지 못했습니다.");
    }

    return data || [];
  }

  async function updateInquiry(id, patch) {
    const table = getTableName("inquiriesTable", "roadmap_inquiries");
    const { data, error } = await getClient()
      .from(table)
      .update(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw normalizeError(error, "문의 상태를 저장하지 못했습니다.");
    }

    return data;
  }

  async function createAttachmentSignedUrl(path, expiresInSeconds) {
    const bucket = getTableName("attachmentsBucket", "inquiry-attachments");
    const { data, error } = await getClient()
      .storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds || 600);

    if (error) {
      throw normalizeError(error, "첨부파일 열람 링크를 만들지 못했습니다.");
    }

    return data.signedUrl;
  }

  function cleanString(value) {
    return String(value || "").trim();
  }

  function normalizeReportMonth(value) {
    const text = cleanString(value);
    if (!text) {
      const today = new Date();
      return today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-01";
    }

    if (/^\d{4}-\d{2}$/.test(text)) {
      return text + "-01";
    }

    return text.slice(0, 10);
  }

  function getReportSelect() {
    return "*, company:companies(id,name,business_type,contact_name,contact_email,phone,status)";
  }

  async function fetchCompanyProfile() {
    const session = await getSession();
    if (!session || !session.user) {
      return null;
    }

    const table = getTableName("companyUsersTable", "company_users");
    const { data, error } = await getClient()
      .from(table)
      .select("id,company_id,email,role,company:companies(id,name,business_type,contact_name,contact_email,phone,status)")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) {
      throw normalizeError(error, "기업 계정 권한을 확인하지 못했습니다.");
    }

    return data || null;
  }

  async function signInCompany(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({
      email: cleanString(email),
      password: String(password || "")
    });

    if (error) {
      throw normalizeError(error, "기업 로그인에 실패했습니다.");
    }

    const profile = await fetchCompanyProfile();
    if (!profile) {
      await signOut();
      throw new Error("기업 권한이 등록되지 않은 계정입니다.");
    }

    return {
      session: data.session,
      user: data.user,
      profile
    };
  }

  async function signInUnified(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({
      email: cleanString(email),
      password: String(password || "")
    });

    if (error) {
      throw normalizeError(error, "로그인에 실패했습니다.");
    }

    const adminProfile = await fetchAdminProfile();
    if (adminProfile) {
      return {
        accountType: "admin",
        session: data.session,
        user: data.user,
        profile: adminProfile
      };
    }

    const companyProfile = await fetchCompanyProfile();
    if (companyProfile) {
      return {
        accountType: "company",
        session: data.session,
        user: data.user,
        profile: companyProfile
      };
    }

    await signOut();
    throw new Error("접속 권한이 등록되지 않은 계정입니다. 회원가입 유형 승인 상태를 확인해주세요.");
  }

  async function fetchCompanies(options) {
    const table = getTableName("companiesTable", "companies");
    const limit = Number(options && options.limit ? options.limit : 200);
    const { data, error } = await getClient()
      .from(table)
      .select("*")
      .order("name", { ascending: true })
      .limit(limit);

    if (error) {
      throw normalizeError(error, "기업 목록을 불러오지 못했습니다.");
    }

    return data || [];
  }

  async function saveCompany(fields) {
    const table = getTableName("companiesTable", "companies");
    const payload = {
      name: cleanString(fields && fields.name),
      business_type: cleanString(fields && fields.businessType),
      contact_name: cleanString(fields && fields.contactName),
      contact_email: cleanString(fields && fields.contactEmail),
      phone: cleanString(fields && fields.phone),
      status: cleanString(fields && fields.status) || "active",
      admin_note: cleanString(fields && fields.adminNote)
    };

    if (!payload.name) {
      throw new Error("기업명을 입력해주세요.");
    }

    const request = fields && fields.id
      ? getClient().from(table).update(payload).eq("id", fields.id)
      : getClient().from(table).insert(payload);
    const { data, error } = await request.select().single();

    if (error) {
      throw normalizeError(error, "기업 정보를 저장하지 못했습니다.");
    }

    return data;
  }

  async function fetchAdminMonthlyReports(options) {
    const table = getTableName("monthlyReportsTable", "monthly_reports");
    const limit = Number(options && options.limit ? options.limit : 100);
    let query = getClient()
      .from(table)
      .select(getReportSelect())
      .order("report_month", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (options && options.companyId) {
      query = query.eq("company_id", options.companyId);
    }

    const { data, error } = await query;

    if (error) {
      throw normalizeError(error, "월별 리포트 목록을 불러오지 못했습니다.");
    }

    return data || [];
  }

  async function fetchCompanyMonthlyReports() {
    const profile = await fetchCompanyProfile();
    if (!profile) {
      throw new Error("기업 권한이 등록되지 않은 계정입니다.");
    }

    const table = getTableName("monthlyReportsTable", "monthly_reports");
    const { data, error } = await getClient()
      .from(table)
      .select(getReportSelect())
      .eq("company_id", profile.company_id)
      .eq("status", "published")
      .order("report_month", { ascending: false });

    if (error) {
      throw normalizeError(error, "공개 리포트 목록을 불러오지 못했습니다.");
    }

    return {
      profile,
      reports: data || []
    };
  }

  async function fetchReportBundle(reportId) {
    const client = getClient();
    const reportsTable = getTableName("monthlyReportsTable", "monthly_reports");
    const noticeTable = getTableName("reportNoticeItemsTable", "report_notice_items");
    const proposalTable = getTableName("reportProposalItemsTable", "report_proposal_items");
    const meetingsTable = getTableName("reportMeetingsTable", "report_meetings");
    const filesTable = getTableName("reportFilesTable", "report_files");

    const { data: report, error: reportError } = await client
      .from(reportsTable)
      .select(getReportSelect())
      .eq("id", reportId)
      .single();

    if (reportError) {
      throw normalizeError(reportError, "리포트 본문을 불러오지 못했습니다.");
    }

    const [
      noticeResult,
      proposalResult,
      meetingResult,
      fileResult
    ] = await Promise.all([
      client.from(noticeTable).select("*").eq("report_id", reportId).order("sort_order", { ascending: true }),
      client.from(proposalTable).select("*").eq("report_id", reportId).order("sort_order", { ascending: true }),
      client.from(meetingsTable).select("*").eq("report_id", reportId).order("sort_order", { ascending: true }),
      client.from(filesTable).select("*").eq("report_id", reportId).order("created_at", { ascending: false })
    ]);

    const failed = [noticeResult, proposalResult, meetingResult, fileResult].find((result) => result.error);
    if (failed) {
      throw normalizeError(failed.error, "리포트 상세 항목을 불러오지 못했습니다.");
    }

    return {
      report,
      noticeItems: noticeResult.data || [],
      proposalItems: proposalResult.data || [],
      meetings: meetingResult.data || [],
      files: fileResult.data || []
    };
  }

  async function replaceReportRows(tableName, reportId, rows) {
    const client = getClient();
    const { error: deleteError } = await client
      .from(tableName)
      .delete()
      .eq("report_id", reportId);

    if (deleteError) {
      throw normalizeError(deleteError, "기존 리포트 항목을 정리하지 못했습니다.");
    }

    if (!rows.length) {
      return [];
    }

    const { data, error } = await client
      .from(tableName)
      .insert(rows)
      .select();

    if (error) {
      throw normalizeError(error, "리포트 항목을 저장하지 못했습니다.");
    }

    return data || [];
  }

  async function saveMonthlyReportBundle(payload) {
    const session = await getSession();
    if (!session || !session.user) {
      throw new Error("관리자 로그인이 필요합니다.");
    }

    const company = await saveCompany(payload.company || {});
    const reportsTable = getTableName("monthlyReportsTable", "monthly_reports");
    const status = payload.status === "published" ? "published" : "draft";
    const now = new Date().toISOString();
    const reportPayload = {
      company_id: company.id,
      report_month: normalizeReportMonth(payload.reportMonth),
      title: cleanString(payload.title) || company.name + " 월별 진행 리포트",
      status,
      planning_summary: cleanString(payload.planningSummary),
      notice_summary: cleanString(payload.noticeSummary),
      proposal_summary: cleanString(payload.proposalSummary),
      meeting_summary: cleanString(payload.meetingSummary),
      next_actions: cleanString(payload.nextActions),
      consultant_name: cleanString(payload.consultantName),
      published_at: status === "published" ? now : null,
      updated_by: session.user.id
    };

    let reportRequest;
    if (payload.reportId) {
      reportRequest = getClient()
        .from(reportsTable)
        .update(reportPayload)
        .eq("id", payload.reportId);
    } else {
      reportRequest = getClient()
        .from(reportsTable)
        .insert(Object.assign({}, reportPayload, { created_by: session.user.id }));
    }

    const { data: report, error } = await reportRequest.select().single();
    if (error) {
      throw normalizeError(error, "월별 리포트를 저장하지 못했습니다.");
    }

    const noticeRows = (payload.noticeItems || [])
      .filter((item) => cleanString(item.title) || cleanString(item.agency) || cleanString(item.notes))
      .slice(0, 5)
      .map((item, index) => ({
        report_id: report.id,
        title: cleanString(item.title) || "맞춤 공고",
        agency: cleanString(item.agency),
        deadline: cleanString(item.deadline) || null,
        fit_score: item.fitScore === "" || item.fitScore === null || typeof item.fitScore === "undefined" ? null : Number(item.fitScore),
        application_status: cleanString(item.applicationStatus) || "검토 중",
        notes: cleanString(item.notes),
        sort_order: index
      }));
    const proposalRows = (payload.proposalItems || [])
      .filter((item) => cleanString(item.sectionTitle) || cleanString(item.consultingContent) || cleanString(item.nextRevision))
      .slice(0, 3)
      .map((item, index) => ({
        report_id: report.id,
        section_title: cleanString(item.sectionTitle) || "사업계획서",
        writing_level: cleanString(item.writingLevel),
        consulting_content: cleanString(item.consultingContent),
        next_revision: cleanString(item.nextRevision),
        sort_order: index
      }));
    const meetingRows = (payload.meetings || [])
      .filter((item) => cleanString(item.title) || cleanString(item.meetingNotes) || cleanString(item.followUp))
      .slice(0, 3)
      .map((item, index) => ({
        report_id: report.id,
        meeting_date: cleanString(item.meetingDate) || null,
        title: cleanString(item.title) || "월간 컨설팅 미팅",
        attendees: cleanString(item.attendees),
        meeting_notes: cleanString(item.meetingNotes),
        follow_up: cleanString(item.followUp),
        sort_order: index
      }));

    await replaceReportRows(getTableName("reportNoticeItemsTable", "report_notice_items"), report.id, noticeRows);
    await replaceReportRows(getTableName("reportProposalItemsTable", "report_proposal_items"), report.id, proposalRows);
    await replaceReportRows(getTableName("reportMeetingsTable", "report_meetings"), report.id, meetingRows);

    return fetchReportBundle(report.id);
  }

  function validateOptionalReportFiles(files) {
    const fileList = Array.from(files || []);
    const maxMb = getMaxFileSizeMb();
    const maxBytes = maxMb * 1024 * 1024;
    const oversized = fileList.find((file) => file.size > maxBytes);
    if (oversized) {
      throw new Error(oversized.name + " 파일은 " + maxMb + "MB 이하로 첨부해주세요.");
    }
    return fileList;
  }

  async function uploadReportFiles(reportId, files, fileRole) {
    const fileList = validateOptionalReportFiles(files);
    if (!fileList.length) {
      return [];
    }

    const session = await getSession();
    const client = getClient();
    const bucket = getTableName("reportFilesBucket", "report-files");
    const table = getTableName("reportFilesTable", "report_files");
    const timestamp = Date.now();
    const rows = [];

    for (let index = 0; index < fileList.length; index += 1) {
      const file = fileList[index];
      const storagePath = [
        reportId,
        String(index + 1).padStart(2, "0") + "-" + timestamp + "-" + safeFileName(file.name)
      ].join("/");

      const { data, error } = await client.storage
        .from(bucket)
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: file.type || undefined,
          upsert: false
        });

      if (error) {
        throw normalizeError(error, "리포트 파일 업로드에 실패했습니다.");
      }

      rows.push({
        report_id: reportId,
        bucket_id: bucket,
        storage_path: data && data.path ? data.path : storagePath,
        name: file.name,
        size: file.size,
        mime_type: file.type || "application/octet-stream",
        file_role: cleanString(fileRole) || "첨부 파일",
        uploaded_by: session && session.user ? session.user.id : null
      });
    }

    const { data: inserted, error: insertError } = await client
      .from(table)
      .insert(rows)
      .select();

    if (insertError) {
      throw normalizeError(insertError, "리포트 파일 정보를 저장하지 못했습니다.");
    }

    return inserted || [];
  }

  async function createReportFileSignedUrl(path, expiresInSeconds) {
    const bucket = getTableName("reportFilesBucket", "report-files");
    const { data, error } = await getClient()
      .storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds || 600);

    if (error) {
      throw normalizeError(error, "리포트 파일 열람 링크를 만들지 못했습니다.");
    }

    return data.signedUrl;
  }

  window.FundingSupabase = {
    STATUS_OPTIONS,
    getConfig,
    isConfigured,
    getClient,
    submitRoadmapInquiry,
    getSession,
    fetchAdminProfile,
    signInAdmin,
    signOut,
    fetchInquiries,
    updateInquiry,
    createAttachmentSignedUrl,
    signInCompany,
    signInUnified,
    fetchCompanyProfile,
    fetchCompanies,
    saveCompany,
    fetchAdminMonthlyReports,
    fetchCompanyMonthlyReports,
    fetchReportBundle,
    saveMonthlyReportBundle,
    uploadReportFiles,
    createReportFileSignedUrl
  };
})();
