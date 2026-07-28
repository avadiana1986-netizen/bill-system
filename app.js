const SUPABASE_URL = "https://kwulrtnhlwqfudpisaol.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3dWxydG5obHdxZnVkcGlzYW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMjE0MTIsImV4cCI6MjEwMDc5NzQxMn0.QZtGAJABvxPOyR_6DMMs2OFw1PaO6u4-2wOE6XHx-Wk";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let people = [];
let aliases = [];
let entries = [];
let shareRules = [];
let currentUser = null;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const norm = (s) => String(s || "").replace(/\s+/g, "").trim().toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

function setStatus(text, ok = true) {
  $("connectionStatus").textContent = text;
  $("connectionStatus").style.background = ok ? "rgba(255,255,255,.14)" : "#bd3b2f";
}

function canEdit() {
  return Boolean(currentUser);
}

function applyAuthState() {
  $("loginOpen").classList.toggle("hidden", canEdit());
  $("logoutButton").classList.toggle("hidden", !canEdit());
  $("authBar").classList.toggle("hidden", canEdit());
  document.querySelectorAll("[data-edit-only]").forEach((el) => {
    el.disabled = !canEdit();
  });
}

function buildMatchers() {
  const map = [];
  for (const p of people) map.push({ key: norm(p.name), person: p });
  for (const a of aliases) {
    const person = people.find((p) => p.id === a.person_id);
    if (person) map.push({ key: norm(a.alias_name), person });
  }
  return map.sort((a, b) => b.key.length - a.key.length);
}

function recognize(rawText) {
  const text = norm(rawText);
  const match = buildMatchers().find((m) => text.includes(m.key));
  if (!match) return { person: null, itemName: rawText, status: "未识别" };
  const originalName = aliases.find((a) => norm(a.alias_name) === match.key)?.alias_name || match.person.name;
  const itemName = String(rawText || "")
    .replace(new RegExp(originalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .replace(/购买/g, "")
    .trim();
  return { person: match.person, itemName: itemName || rawText, status: "已识别" };
}

function updatePreview(rawId, itemId, previewId) {
  const rawText = $(rawId).value;
  const result = recognize(rawText);
  if (!$(itemId).value && result.itemName) $(itemId).value = result.itemName;
  $(previewId).textContent = result.person
    ? `识别为：${result.person.group_name} / ${result.person.name}`
    : "未识别：保存后会进入未识别登记";
}

async function loadAll() {
  setStatus("读取数据中");
  const [peopleRes, aliasRes, entryRes, ruleRes] = await Promise.all([
    db.from("people").select("*").order("group_name").order("name"),
    db.from("aliases").select("*"),
    db.from("ledger_entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    db.from("share_rules").select("*").eq("enabled", true),
  ]);
  for (const res of [peopleRes, aliasRes, entryRes, ruleRes]) {
    if (res.error) throw res.error;
  }
  people = peopleRes.data || [];
  aliases = aliasRes.data || [];
  entries = entryRes.data || [];
  shareRules = ruleRes.data || [];
  setStatus("已连接");
  render();
}

function getBaseByPerson() {
  const map = new Map();
  for (const e of entries) {
    if (!e.person_id) continue;
    map.set(e.person_id, (map.get(e.person_id) || 0) + Number(e.amount || 0));
  }
  return map;
}

function getShareByPerson() {
  const map = new Map();
  const activePeople = people.filter((p) => p.active);
  for (const rule of shareRules) {
    const amount = Number(rule.amount || 0);
    const cfg = rule.rule_config || {};
    let targets = [];
    if (rule.rule_type === "group") {
      targets = activePeople.filter((p) => p.group_name === cfg.group_name);
    } else if (rule.rule_type === "exclude_groups") {
      targets = activePeople.filter((p) => !(cfg.exclude_groups || []).includes(p.group_name));
    } else if (rule.rule_type === "exclude_people_and_groups") {
      targets = activePeople.filter((p) => !(cfg.exclude_groups || []).includes(p.group_name) && !(cfg.exclude_people || []).includes(p.name));
    } else if (rule.rule_type === "specified_people") {
      const names = ["百金汇","百圣主","百小多","百小天","百星辰","百汐","百发百中","百瑞","百小龙","百三炮","百小伟","百撤","百天成","百高乐","百金翰","百祥瑞","百海洋","百阿斌"];
      targets = activePeople.filter((p) => names.includes(p.name));
    }
    if (!targets.length) continue;
    const each = rule.rule_type === "specified_people" && cfg.per_person ? Number(cfg.per_person) : amount / targets.length;
    for (const p of targets) map.set(p.id, (map.get(p.id) || 0) + each);
  }
  return map;
}

function render() {
  const base = getBaseByPerson();
  const share = getShareByPerson();
  const unknownEntries = entries.filter((e) => e.status === "未识别");
  const peopleRows = people.filter((p) => p.active).map((p) => {
    const baseAmount = base.get(p.id) || 0;
    const shareAmount = share.get(p.id) || 0;
    return {
      ...p,
      baseAmount,
      shareAmount,
      finalAmount: baseAmount + shareAmount,
      count: entries.filter((e) => e.person_id === p.id).length,
    };
  });
  const unknownTotal = unknownEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const baseTotal = peopleRows.reduce((s, r) => s + r.baseAmount, 0) + unknownTotal;
  const shareTotal = peopleRows.reduce((s, r) => s + r.shareAmount, 0);
  $("kpiBase").textContent = fmt(baseTotal);
  $("kpiShare").textContent = fmt(shareTotal);
  $("kpiFinal").textContent = fmt(baseTotal + shareTotal);
  $("kpiUnknown").textContent = unknownEntries.length;

  renderSummary(peopleRows, unknownEntries);
  renderPeople(peopleRows);
  renderLedger();
}

function renderSummary(peopleRows, unknownEntries) {
  const groups = new Map();
  for (const row of peopleRows) {
    const g = groups.get(row.group_name) || { group: row.group_name, people: 0, base: 0, share: 0, final: 0 };
    g.people += 1;
    g.base += row.baseAmount;
    g.share += row.shareAmount;
    g.final += row.finalAmount;
    groups.set(row.group_name, g);
  }
  if (unknownEntries.length) {
    const base = unknownEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
    groups.set("未识别登记", { group: "未识别登记", people: unknownEntries.length, base, share: 0, final: base });
  }
  const rows = [...groups.values()];
  const totals = rows.reduce((t, r) => ({
    people: t.people + r.people,
    base: t.base + r.base,
    share: t.share + r.share,
    final: t.final + r.final,
  }), { people: 0, base: 0, share: 0, final: 0 });
  $("summaryBody").innerHTML = rows.map((r) => `
    <tr>
      <td>${r.group}</td><td>${r.people}</td><td>${fmt(r.base)}</td><td>${fmt(r.share)}</td><td class="final">${fmt(r.final)}</td>
    </tr>`).join("") + `
    <tr class="total"><td>总计</td><td>${totals.people}</td><td>${fmt(totals.base)}</td><td>${fmt(totals.share)}</td><td>${fmt(totals.final)}</td></tr>`;
}

function renderPeople(rows) {
  const keyword = norm($("personSearch").value);
  const filtered = rows.filter((r) => !keyword || norm(r.name).includes(keyword) || norm(r.group_name).includes(keyword));
  $("peopleBody").innerHTML = filtered.map((r) => `
    <tr>
      <td>${r.group_name}</td><td>${r.name}</td><td>${fmt(r.baseAmount)}</td><td>${fmt(r.shareAmount)}</td><td class="final">${fmt(r.finalAmount)}</td><td>${r.count}</td>
    </tr>`).join("");
}

function renderLedger() {
  const status = $("statusFilter").value;
  const rows = entries.filter((e) => !status || e.status === status);
  $("ledgerBody").innerHTML = rows.map((e) => {
    const person = people.find((p) => p.id === e.person_id);
    return `<tr class="${e.status === "未识别" ? "unknown" : ""}">
      <td>${e.entry_date || ""}</td>
      <td>${e.raw_text || ""}</td>
      <td>${person?.name || ""}</td>
      <td>${e.group_name || ""}</td>
      <td>${fmt(e.amount)}</td>
      <td>${e.status}</td>
      <td><div class="row-actions"><button data-edit-only onclick="openEdit('${e.id}')" ${canEdit() ? "" : "disabled"}>修改</button><button data-edit-only class="danger" onclick="deleteEntry('${e.id}')" ${canEdit() ? "" : "disabled"}>删除</button></div></td>
    </tr>`;
  }).join("");
}

async function saveEntry(form) {
  if (!canEdit()) return alert("请先登录后再保存账单");
  const rawText = form.rawText.value.trim();
  const result = recognize(rawText);
  const payload = {
    entry_date: form.entryDate.value,
    raw_text: rawText,
    item_name: form.itemName.value.trim() || result.itemName,
    amount: Number(form.amount.value || 0),
    person_id: result.person?.id || null,
    group_name: result.person?.group_name || null,
    status: result.status,
  };
  const { error } = await db.from("ledger_entries").insert(payload);
  if (error) throw error;
  form.reset();
  $("entryDate").value = today();
  $("recognitionPreview").textContent = "保存成功";
  await loadAll();
}

window.openEdit = (id) => {
  if (!canEdit()) return alert("请先登录后再修改账单");
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  $("editId").value = e.id;
  $("editDate").value = e.entry_date;
  $("editRawText").value = e.raw_text;
  $("editAmount").value = e.amount;
  $("editItemName").value = e.item_name || "";
  updatePreview("editRawText", "editItemName", "editPreview");
  $("editDialog").showModal();
};

window.deleteEntry = async (id) => {
  if (!canEdit()) return alert("请先登录后再删除账单");
  if (!confirm("确定删除这条账单吗？")) return;
  const { error } = await db.from("ledger_entries").delete().eq("id", id);
  if (error) alert(error.message);
  await loadAll();
};

$("entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveEntry(event.target);
  } catch (error) {
    alert(error.message);
  }
});

$("editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canEdit()) return alert("请先登录后再修改账单");
  const rawText = $("editRawText").value.trim();
  const result = recognize(rawText);
  const payload = {
    entry_date: $("editDate").value,
    raw_text: rawText,
    item_name: $("editItemName").value.trim() || result.itemName,
    amount: Number($("editAmount").value || 0),
    person_id: result.person?.id || null,
    group_name: result.person?.group_name || null,
    status: result.status,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("ledger_entries").update(payload).eq("id", $("editId").value);
  if (error) return alert(error.message);
  $("editDialog").close();
  await loadAll();
});

$("cancelEdit").addEventListener("click", () => $("editDialog").close());
$("loginOpen").addEventListener("click", () => $("loginDialog").showModal());
$("cancelLogin").addEventListener("click", () => $("loginDialog").close());
$("logoutButton").addEventListener("click", async () => {
  await db.auth.signOut();
  currentUser = null;
  applyAuthState();
  await loadAll();
});
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginMessage").textContent = "正在登录...";
  const { data, error } = await db.auth.signInWithPassword({
    email: $("loginEmail").value.trim(),
    password: $("loginPassword").value,
  });
  if (error) {
    $("loginMessage").textContent = error.message;
    return;
  }
  currentUser = data.user;
  $("loginDialog").close();
  applyAuthState();
  await loadAll();
});
$("rawText").addEventListener("input", () => updatePreview("rawText", "itemName", "recognitionPreview"));
$("editRawText").addEventListener("input", () => updatePreview("editRawText", "editItemName", "editPreview"));
$("personSearch").addEventListener("input", render);
$("statusFilter").addEventListener("change", renderLedger);

$("entryDate").value = today();
(async function init() {
  const { data } = await db.auth.getSession();
  currentUser = data.session?.user || null;
  db.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    applyAuthState();
    render();
  });
  applyAuthState();
  await loadAll();
})().catch((error) => {
  console.error(error);
  setStatus("连接失败", false);
  alert(error.message);
});
