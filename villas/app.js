(() => {
  const CONFIG = {
    whatsappNumber: "628999844455",
    leadEndpoint: "/api/villa-lead",
    advertiseText: "Hello! I’d like to advertise my villa on the Bali Discount Villas page."
  };

  const modal = document.getElementById("requestModal");
  const form = document.getElementById("villaRequestForm");
  const areaField = document.getElementById("areaField");
  const formStatus = document.getElementById("formStatus");
  let lastFocused = null;

  const waUrl = text => `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(text)}`;

  document.querySelectorAll(".js-advertise-link").forEach(link => {
    link.href = waUrl(CONFIG.advertiseText);
  });

  const openModal = area => {
    lastFocused = document.activeElement;
    if (area && areaField) areaField.value = area;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.setTimeout(() => {
      const first = modal.querySelector("select,input,textarea,button");
      first?.focus();
    }, 30);
  };

  const closeModal = () => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  };

  document.querySelectorAll(".js-open-request").forEach(button => {
    button.addEventListener("click", () => openModal());
  });

  document.querySelectorAll(".js-area-request").forEach(button => {
    button.addEventListener("click", () => openModal(button.dataset.area || ""));
  });

  document.querySelectorAll("[data-close-modal]").forEach(el => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) closeModal();
  });

  const dateInputs = form.querySelectorAll('input[type="date"]');
  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  dateInputs.forEach(input => input.min = localToday);

  const clean = value => String(value || "").trim();

  const buildLead = data => {
    const lines = [
      "🏡 NEW VILLA REQUEST — Bali Discount",
      "",
      `Rental: ${clean(data.get("stayType")) || "—"}`,
      `Area: ${clean(data.get("area")) || "—"}`,
      `Check-in: ${clean(data.get("checkIn")) || "Flexible"}`,
      `Check-out: ${clean(data.get("checkOut")) || "Flexible"}`,
      `Bedrooms: ${clean(data.get("bedrooms")) || "—"}`,
      `Guests: ${clean(data.get("guests")) || "—"}`,
      `Budget: ${clean(data.get("budget")) || "—"} ${clean(data.get("currency")) || ""}`,
      "",
      `Requirements: ${clean(data.get("requirements")) || "—"}`,
      "",
      `Name: ${clean(data.get("name")) || "—"}`,
      `WhatsApp: ${clean(data.get("whatsapp")) || "—"}`
    ];
    return lines.join("\n");
  };

  async function sendToEndpoint(payload) {
    const response = await fetch(CONFIG.leadEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Lead endpoint returned ${response.status}`);
    return response;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const submit = form.querySelector(".submit-button");
    const data = new FormData(form);
    const message = buildLead(data);

    submit.disabled = true;
    formStatus.textContent = "Preparing your request…";

    try {
      const payload = Object.fromEntries(data.entries());
      payload.source = "bali.discount/villas";
      payload.createdAt = new Date().toISOString();
      await sendToEndpoint(payload);
      formStatus.textContent = "Request sent. We’ll contact you on WhatsApp with suitable villa options.";
      form.reset();
    } catch (error) {
      console.error(error);
      formStatus.textContent = "Direct delivery is temporarily unavailable. Opening WhatsApp instead…";
      window.open(waUrl(message), "_blank", "noopener");
    } finally {
      submit.disabled = false;
    }
  });

  // Future Agoda / Travelpayouts integration:
  // Mount the partner widget inside #travelpayoutsSlot and remove [hidden]
  // from #partnerStays. The rest of the page does not need to change.
})();
