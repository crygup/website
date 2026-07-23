(function () {
  const tabs = document.querySelectorAll("#mudae-tabs .tab-btn[data-tab]");
  const panels = document.querySelectorAll("[data-panel]");

  function selectTab(tab, updateUrl = true) {
    const selected = document.querySelector(
      `#mudae-tabs .tab-btn[data-tab="${tab}"]`,
    );
    if (!selected) return;

    tabs.forEach((button) => {
      const active = button === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    panels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== tab);
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (tab === "oc") url.searchParams.delete("tab");
      else url.searchParams.set("tab", tab);
      window.history.replaceState(null, "", url);
    }
  }

  tabs.forEach((button) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
  });

  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  selectTab(requestedTab === "oq" ? "oq" : "oc", false);
})();
