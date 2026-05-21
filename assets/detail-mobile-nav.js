(function () {
  const menuToggle = document.querySelector(".menu-toggle");
  const navMenu = document.getElementById("detailNavMenu");

  if (!menuToggle || !navMenu) {
    return;
  }

  const closeMobileMenu = () => {
    navMenu.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "주요 메뉴 열기");
  };

  menuToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = navMenu.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "주요 메뉴 닫기" : "주요 메뉴 열기");
  });

  navMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMobileMenu);
  });

  document.addEventListener("click", (event) => {
    if (!navMenu.classList.contains("is-open")) {
      return;
    }

    if (!event.target.closest(".header")) {
      closeMobileMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMobileMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      closeMobileMenu();
    }
  });
})();
