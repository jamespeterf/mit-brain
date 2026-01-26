// MIT Brain Authentication Helper
// Adds user menu and logout button to navigation

(function() {
  async function initAuth() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) return;

      const data = await res.json();
      const user = data.user;

      // Find the nav links container
      const navLinks = document.querySelector('.mit-brain-nav-links');
      if (!navLinks) return;

      // Hide Admin link for non-admin users
      if (user.role !== 'admin') {
        const adminLink = navLinks.querySelector('.nav-admin');
        if (adminLink) {
          adminLink.style.display = 'none';
        }
      }

      // Create user menu
      const userMenu = document.createElement('div');
      userMenu.className = 'mit-brain-user-menu';
      userMenu.innerHTML = `
        <span class="mit-brain-user-info">${escapeHtml(user.firstName)}</span>
        <button class="mit-brain-logout-btn" onclick="logout()">Logout</button>
      `;

      navLinks.appendChild(userMenu);
    } catch (err) {
      console.error('Auth init error:', err);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Global logout function
  window.logout = async function() {
    try {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    } catch (err) {
      console.error('Logout error:', err);
      window.location.href = '/login.html';
    }
  };

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }
})();
