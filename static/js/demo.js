/** 日常任务演示站：资讯 / 模拟购物 / 模拟预约 + 可选头控 */
import { $, $$, bindNav, setActiveNav, toast, speak } from "./common.js";
import { createControlRuntime } from "./control-runtime.js";
import { collectTargets } from "./target-collector.js";

bindNav();
setActiveNav("demo");

const NEWS = [
  { id: "n1", title: "社区无障碍设施本周升级", body: "盲道与语音导航同步改造，居民可预约体验。" },
  { id: "n2", title: "适老化手机课堂开课", body: "每周三下午，志愿者一对一教学挂号与缴费。" },
  { id: "n3", title: "医保线上办理更便捷", body: "常见证明可全程网办，减少跑腿次数。" },
];

const GOODS = [
  { id: "g1", name: "燕麦片礼盒", price: 39 },
  { id: "g2", name: "保温杯", price: 59 },
  { id: "g3", name: "血压计", price: 129 },
];

const TMALL_ITEMS = [
  { id: "t1", name: "天猫超市 · 燕麦片", price: 36 },
  { id: "t2", name: "天猫自营 · 保温杯", price: 55 },
  { id: "t3", name: "天猫健康 · 血压计", price: 119 },
  { id: "t4", name: "天猫国际 · 维生素", price: 89 },
];

const DEPTS = [
  { id: "internal", icon: "🫁", name: "内科", desc: "感冒、慢病复诊、高血压" },
  { id: "surgery", icon: "🩹", name: "外科", desc: "外伤、术后复查" },
  { id: "pedia", icon: "🧸", name: "儿科", desc: "儿童常见病、疫苗咨询" },
  { id: "gyn", icon: "🌸", name: "妇产科", desc: "妇科检查、产检预约" },
  { id: "eye", icon: "👁️", name: "眼科", desc: "验光、干眼、结膜炎" },
];

const DOCTORS = [
  { id: "d1", name: "李敏", title: "主任医师", skill: "高血压、糖尿病" },
  { id: "d2", name: "王强", title: "副主任医师", skill: "呼吸道感染" },
  { id: "d3", name: "陈洁", title: "主治医师", skill: "消化内科" },
];

const DAYS = [
  { id: "today", label: "今天" },
  { id: "tmr", label: "明天" },
  { id: "dat", label: "后天" },
];

const SLOTS = {
  today: [
    { id: "t1", time: "08:30-09:00", left: 0 },
    { id: "t2", time: "09:30-10:00", left: 3 },
    { id: "t3", time: "10:30-11:00", left: 5 },
    { id: "t4", time: "14:00-14:30", left: 2 },
  ],
  tmr: [
    { id: "m1", time: "08:30-09:00", left: 6 },
    { id: "m2", time: "09:30-10:00", left: 8 },
    { id: "m3", time: "10:30-11:00", left: 4 },
    { id: "m4", time: "14:00-14:30", left: 7 },
  ],
  dat: [
    { id: "d1s", time: "08:30-09:00", left: 9 },
    { id: "d2s", time: "09:30-10:00", left: 5 },
    { id: "d3s", time: "10:30-11:00", left: 3 },
    { id: "d4s", time: "14:00-14:30", left: 6 },
  ],
};

const state = {
  scene: "browse",
  step: 1,
  dept: null,
  doctor: DOCTORS[0],
  day: "today",
  slot: null,
  name: "",
  id: "",
  phone: "",
  ins: "城镇职工医保",
  cart: [],
  article: null,
};

let runtime = null;

function setScene(id) {
  state.scene = id;
  $$(".scene-panel").forEach((p) => {
    const on = p.dataset.scene === id;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
  $$("#scene-tabs button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.scene === id);
    b.setAttribute("aria-selected", b.dataset.scene === id ? "true" : "false");
  });
  if (id !== "shop") {
    const sc = $("#shop-confirm");
    if (sc) sc.hidden = true;
  }
  runtime?.refreshTargets();
}
window.__ddkSetScene = setScene;
window.__ddkOpenTmall = openTmall;
window.__ddkCloseTmall = () => {
  const shell = document.getElementById("tmall-shell");
  if (shell && !shell.hidden) {
    closeTmall();
    return true;
  }
  return false;
};

function setStep(n) {
  state.step = n;
  $$("#steps li").forEach((li) => {
    const s = Number(li.dataset.s);
    li.classList.toggle("is-active", s === n);
    li.classList.toggle("is-done", s < n);
  });
  $$("[data-panel]").forEach((p) => {
    const on = Number(p.dataset.panel) === n;
    p.classList.toggle("is-active", on);
    p.hidden = !on;
  });
  if (n === 4) renderSummary();
  if (n === 5) renderQR();
  runtime?.refreshTargets();
}

function renderSceneTabs() {
  const box = $("#scene-tabs");
  box.innerHTML = "";
  [
    { id: "browse", label: "看资讯" },
    { id: "shop", label: "模拟购物" },
    { id: "clinic", label: "社区预约" },
  ].forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "scene-tab" + (s.id === state.scene ? " is-active" : "");
    b.dataset.scene = s.id;
    b.dataset.click = "";
    b.setAttribute("role", "tab");
    b.textContent = s.label;
    b.addEventListener("click", () => setScene(s.id));
    box.appendChild(b);
  });
}

function renderNews() {
  const box = $("#browse-list");
  box.innerHTML = "";
  NEWS.forEach((n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "news-card";
    b.dataset.click = "";
    b.innerHTML = `<strong>${n.title}</strong><span>${n.body.slice(0, 18)}…</span>`;
    b.addEventListener("click", () => {
      state.article = n;
      $("#article-title").textContent = n.title;
      $("#article-body").textContent = n.body;
      $("#article").hidden = false;
      $("#browse-list").hidden = true;
      runtime?.refreshTargets();
    });
    box.appendChild(b);
  });
}

function renderGoods() {
  const box = $("#goods-grid");
  box.innerHTML = "";
  GOODS.forEach((g) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "goods-card";
    b.dataset.click = "";
    b.innerHTML = `<strong>${g.name}</strong><span>¥${g.price}</span><em>加入购物车</em>`;
    b.addEventListener("click", () => {
      state.cart.push(g);
      renderCart();
      toast(`已加入 ${g.name}`);
      speak(`已加入${g.name}`, runtime?.ttsOn?.() ?? true);
    });
    box.appendChild(b);
  });
  renderCart();
}

function renderCart() {
  const el = $("#cart-list");
  if (!state.cart.length) {
    el.textContent = "空";
  } else {
    el.innerHTML = state.cart
      .map((g) => `<div class="cart-row"><span>${g.name}</span><strong>¥${g.price}</strong></div>`)
      .join("");
  }
  const sum = state.cart.reduce((a, b) => a + b.price, 0);
  if ($("#shop-summary")) {
    /* filled at confirm */
  }
  state.cartSum = sum;
}

function renderDepts() {
  const box = $("#dept-grid");
  box.innerHTML = "";
  DEPTS.forEach((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dept-card";
    b.dataset.click = "";
    b.innerHTML = `<span class="icon">${d.icon}</span><strong>${d.name}</strong><span>${d.desc}</span>`;
    b.addEventListener("click", () => {
      state.dept = d;
      $$(".dept-card").forEach((x) => x.classList.remove("is-selected"));
      b.classList.add("is-selected");
      setStep(2);
    });
    box.appendChild(b);
  });
}

function renderDocs() {
  const box = $("#doc-list");
  box.innerHTML = "";
  DOCTORS.forEach((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "doc-card" + (d.id === state.doctor.id ? " is-selected" : "");
    b.dataset.click = "";
    b.innerHTML = `<strong>${d.name} · ${d.title}</strong><span>擅长：${d.skill}</span>`;
    b.addEventListener("click", () => {
      state.doctor = d;
      renderDocs();
    });
    box.appendChild(b);
  });
}

function renderDays() {
  const box = $("#day-tabs");
  box.innerHTML = "";
  DAYS.forEach((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day-tab" + (d.id === state.day ? " is-active" : "");
    b.dataset.click = "";
    b.textContent = d.label;
    b.addEventListener("click", () => {
      state.day = d.id;
      state.slot = null;
      renderDays();
      renderSlots();
    });
    box.appendChild(b);
  });
}

function renderSlots() {
  const box = $("#slot-grid");
  box.innerHTML = "";
  (SLOTS[state.day] || []).forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "slot" + (state.slot?.id === s.id ? " is-selected" : "");
    b.dataset.click = "";
    b.disabled = s.left <= 0;
    b.innerHTML = `${s.time}<small>剩余 ${s.left} 个号</small>`;
    b.addEventListener("click", () => {
      state.slot = { ...s, dayLabel: DAYS.find((d) => d.id === state.day)?.label };
      renderSlots();
    });
    box.appendChild(b);
  });
}

function renderSummary() {
  state.name = $("#f-name").value || state.name;
  state.id = $("#f-id").value || state.id;
  state.phone = $("#f-phone").value || state.phone;
  state.ins = $("#f-ins").value || state.ins;
  const rows = [
    ["科室", state.dept?.name || "—"],
    ["医生", `${state.doctor.name} · ${state.doctor.title}`],
    ["时间", `${state.slot?.dayLabel || ""} ${state.slot?.time || "—"}`],
    ["姓名", state.name || "未填写（演示）"],
    ["身份证", state.id || "未填写（演示）"],
    ["手机", state.phone || "未填写（演示）"],
    ["医保", state.ins],
  ];
  const summary = $("#summary");
  summary.replaceChildren();
  rows.forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "summary-row";
    const label = document.createElement("span");
    label.textContent = key;
    const content = document.createElement("strong");
    content.textContent = value;
    row.append(label, content);
    summary.appendChild(row);
  });
}

function renderQR() {
  const qr = $("#qr");
  if (!qr || qr.dataset.done) return;
  qr.dataset.done = "1";
  qr.innerHTML = "";
  const size = 11;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = document.createElement("i");
      const corner =
        (x < 3 && y < 3) || (x >= size - 3 && y < 3) || (x < 3 && y >= size - 3);
      let on;
      if (corner) {
        const cx = x < 3 ? x : x - (size - 3);
        const cy = y < 3 ? y : y - (size - 3);
        on = cx === 0 || cx === 2 || cy === 0 || cy === 2 || (cx === 1 && cy === 1);
      } else {
        const h = (x * 17 + y * 31 + x * y * 3) % 7;
        on = h < 3;
      }
      if (!on) cell.classList.add("off");
      qr.appendChild(cell);
    }
  }
}

function openTmall() {
  const shell = $("#tmall-shell");
  if (!shell) return;
  const grid = $("#tmall-grid");
  if (grid && !grid.childElementCount) {
    TMALL_ITEMS.forEach((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tmall-card";
      b.dataset.click = "";
      b.innerHTML = `<strong>${g.name}</strong><span class="price">¥${g.price}</span><span class="hint">点头控 / 张嘴加入购物车</span>`;
      b.addEventListener("click", () => {
        b.classList.toggle("is-in");
        toast(b.classList.contains("is-in") ? `已加入 ${g.name}` : `已移出 ${g.name}`);
        speak(b.classList.contains("is-in") ? "已加入购物车" : "已移出", runtime?.ttsOn?.() ?? true);
        runtime?.refreshTargets();
      });
      grid.appendChild(b);
    });
  }
  shell.hidden = false;
  $("#demo-status").textContent = "已进入模拟购物页；选商品、加购与确认仅为演示。";
  runtime?.refreshTargets();
  speak("已进入天猫购物", runtime?.ttsOn?.() ?? true);
}

function closeTmall() {
  const shell = $("#tmall-shell");
  if (!shell) return;
  shell.hidden = true;
  $("#demo-status").textContent = "已返回演示站";
  toast("已返回演示站");
  runtime?.refreshTargets();
}

window.__ddkOpenTmall = openTmall;
window.__ddkCloseTmall = () => {
  const el = document.getElementById("tmall-shell");
  if (el && !el.hidden) {
    closeTmall();
    return true;
  }
  return false;
};

function bindShop() {
  $("#btn-tmall-open")?.addEventListener("click", openTmall);
  $("#btn-tmall-close")?.addEventListener("click", closeTmall);
  $("#btn-tmall-back2")?.addEventListener("click", closeTmall);
  $("#btn-tmall-real")?.addEventListener("click", () => {
    window.open("https://www.tmall.com", "_blank", "noopener,noreferrer");
    toast("已在新标签打开天猫官网（需手动关标签）");
  $("#demo-status").textContent = "已另开天猫官网；此演示不会读取或控制官网页面。";
    runtime?.refreshTargets();
  });
  $("#btn-shop-next")?.addEventListener("click", () => {
    if (!state.cart.length) {
      toast("请先加入商品");
      return;
    }
    $("#shop-summary").innerHTML = [
      ...state.cart.map((g) => `<div class="summary-row"><span>${g.name}</span><strong>¥${g.price}</strong></div>`),
      `<div class="summary-row"><span>合计</span><strong>¥${state.cartSum || 0}</strong></div>`,
    ].join("");
    $("#shop-confirm").hidden = false;
    $("#cart-box").hidden = true;
    runtime?.refreshTargets();
  });
  $("#btn-shop-back")?.addEventListener("click", () => {
    $("#shop-confirm").hidden = true;
    $("#cart-box").hidden = false;
    runtime?.refreshTargets();
  });
  $("#btn-shop-submit")?.addEventListener("click", () => {
    $("#shop-confirm").hidden = true;
    $("#shop-success").hidden = false;
    speak("购物流程演示完成，没有创建真实订单", runtime?.ttsOn?.() ?? true);
  });
  $("#btn-shop-again")?.addEventListener("click", () => {
    state.cart = [];
    renderCart();
    $("#shop-success").hidden = true;
    $("#cart-box").hidden = false;
    runtime?.refreshTargets();
  });
}

function bindClinic() {
  $("#btn-next-2")?.addEventListener("click", () => {
    if (!state.slot) {
      toast("请先选择一个时段");
      return;
    }
    setStep(3);
  });
  $("#btn-next-3")?.addEventListener("click", () => setStep(4));
  $("#btn-back-1")?.addEventListener("click", () => setStep(1));
  $("#btn-back-2")?.addEventListener("click", () => setStep(2));
  $("#btn-back-3")?.addEventListener("click", () => setStep(3));
  $("#btn-submit")?.addEventListener("click", () => setStep(5));
  $("#btn-home")?.addEventListener("click", () => (location.href = "/index.html"));
  $("#btn-back-news")?.addEventListener("click", () => {
    $("#article").hidden = true;
    $("#browse-list").hidden = false;
    runtime?.refreshTargets();
  });
  $("#btn-reset")?.addEventListener("click", () => {
    state.dept = null;
    state.slot = null;
    state.day = "today";
    state.cart = [];
    state.article = null;
    closeTmall();
    delete $("#qr")?.dataset.done;
    renderNews();
    renderGoods();
    renderDepts();
    renderDocs();
    renderDays();
    renderSlots();
    setStep(1);
    setScene("browse");
    toast("场景已重置");
  });
}

async function setupRuntime() {
  const video = $("#video");
  const overlay = $("#overlay");
  const camBox = $("#demo-cam");
  const vcursor = $("#vcursor");

  runtime = createControlRuntime({
    videoEl: video,
    overlayEl: overlay,
    padEl: document.querySelector(".demo-shell") || document.body,
    dotEl: vcursor,
    targetsRoot: document.querySelector(".demo-shell") || document,
    pageLabel: "demo",
    onStatus: (s) => {
      if (s.type === "lock" && s.target) {
        $("#demo-status").textContent = `已选中“${s.target.text || "目标"}”；可说“点击”，也可继续移动自由光标。`;
      }
      if (s.type === "voice_cmd") {
        $("#demo-status").textContent = `命令：${s.cmd.label}`;
      }
      if (s.type === "voice_error") {
        $("#demo-status").textContent = `${s.message} 你仍可使用头控或按钮操作。`;
        if (s.fatal) $("#btn-demo-mic").textContent = "重试语音聆听";
      }
      if (s.type === "voice_state") {
        $("#btn-demo-mic").textContent = s.listening ? "停止聆听" : s.reason === "error" || s.reason === "start-error" || s.reason === "restart-error" ? "重试语音聆听" : "语音聆听";
      }
      if (s.type === "model_ok") {
    $("#demo-status").textContent = "头控已就绪：转头移动光标，短促张嘴直接点击当前指针。";
      }
      if (s.type === "model_error") {
        $("#demo-status").textContent = "本地识别模型加载失败；检查网络/模型文件后重试，或继续用按钮与键盘。";
      }
      if (s.type === "cam_error") {
        $("#demo-status").textContent = `${s.message || "摄像头未能开启。"} 也可直接用按钮与键盘体验。`;
      }
    },
    onCommand: (cmd) => {
      if (cmd.action === "scene_browse" || cmd.action === "scene_shop" || cmd.action === "scene_clinic") {
        setScene(cmd.action.replace("scene_", ""));
        return "handled";
      }
      if (cmd.action === "tmall") {
        setScene("shop");
        openTmall();
        return "handled";
      }
      if (cmd.action === "back_close") {
        if (window.__ddkCloseTmall?.()) return "handled";
        return undefined;
      }
      return undefined;
    },
  });
  window.__ddk = { runtime, collectTargets, setScene };

  $("#btn-page-up")?.addEventListener("click", () => {
    window.scrollBy({ top: -320, behavior: "smooth" });
  });
  $("#btn-page-down")?.addEventListener("click", () => {
    window.scrollBy({ top: 320, behavior: "smooth" });
  });
  $("#btn-demo-cam")?.addEventListener("click", async () => {
    if (runtime.streaming) {
      runtime.stopCam(true);
      camBox.hidden = true;
      $("#btn-demo-cam").textContent = "在此页开启头控";
      $("#demo-status").textContent = "头控已停止；演示仍可用按钮和键盘操作。";
      return;
    }
    camBox.hidden = false;
    const ok = await runtime.startCam();
    if (ok) {
      $("#btn-demo-cam").textContent = "停止头控";
      runtime.refreshTargets();
    } else {
      camBox.hidden = true;
      $("#btn-demo-cam").textContent = "重试开启头控";
    }
  });
  // 若控制台已开过摄像头，进演示站也自动恢复
  if (runtime.camWanted()) {
    camBox.hidden = false;
    runtime.resumeCamIfWanted().then((ok) => {
      if (ok) {
        $("#btn-demo-cam").textContent = "停止头控";
        runtime.refreshTargets();
      }
    });
  }
  $("#btn-demo-mic")?.addEventListener("click", () => {
    if (!runtime.voice.supported) {
      toast("请用 Chrome/Edge 语音");
      return;
    }
    if (runtime.voice.listening) {
      runtime.voice.stop();
      $("#btn-demo-mic").textContent = "语音聆听";
    } else {
      const ok = runtime.voice.start();
      $("#btn-demo-mic").textContent = ok ? "停止聆听" : "重试语音聆听";
    }
  });
}

renderSceneTabs();
renderNews();
renderGoods();
renderDepts();
renderDocs();
renderDays();
renderSlots();
setStep(1);
setScene("browse");
bindShop();
bindClinic();
setupRuntime();
