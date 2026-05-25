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
    createAttachmentSignedUrl
  };
})();
