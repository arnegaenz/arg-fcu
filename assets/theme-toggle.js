// Dark mode toggle functionality
(function() {
  const STORAGE_KEY = 'argfcu-theme';

  // Get saved theme or default to light
  const savedTheme = localStorage.getItem(STORAGE_KEY) || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Wait for DOM to be ready
  function initThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    // Set initial icon
    updateToggleIcon(savedTheme);

    // Handle toggle click
    toggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem(STORAGE_KEY, newTheme);
      updateToggleIcon(newTheme);
    });
  }

  function updateToggleIcon(theme) {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeToggle);
  } else {
    initThemeToggle();
  }
})();
