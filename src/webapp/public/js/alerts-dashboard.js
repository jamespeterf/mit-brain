// =============================================================================
// MIT Brain Alerts Dashboard - JavaScript
// =============================================================================

// Get personId from URL or localStorage
const urlParams = new URLSearchParams(window.location.search);
let personId = urlParams.get('personId') || localStorage.getItem('currentPersonId');

// Auto-detect personId if not set
async function detectPersonId() {
  if (personId) {
    console.log('📋 Using personId:', personId);
    return personId;
  }
  
  try {
    const response = await fetch('/api/people');
    const people = await response.json();
    
    if (people && people.length > 0) {
      personId = people[0].id;
      localStorage.setItem('currentPersonId', personId);
      console.log('📋 Auto-detected personId:', personId);
      return personId;
    }
  } catch (err) {
    console.error('❌ Error detecting personId:', err);
  }
  
  // Fallback
  personId = 'default';
  console.warn('⚠️  Using default personId');
  return personId;
}

// DOM Elements
const alertsList = document.getElementById('alertsList');
const emptyState = document.getElementById('emptyState');
const createAlertBtn = document.getElementById('createAlertBtn');
const filterStatus = document.getElementById('filterStatus');
const deleteModal = document.getElementById('deleteModal');
const deleteAlertName = document.getElementById('deleteAlertName');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');

// State
let alerts = [];
let alertToDelete = null;

// =============================================================================
// Initialize
// =============================================================================

document.addEventListener('DOMContentLoaded', async function() {
  await detectPersonId();
  console.log('Alerts Dashboard initialized for personId:', personId);
  
  setupEventListeners();
  loadAlerts();
});

// =============================================================================
// Event Listeners
// =============================================================================

function setupEventListeners() {
  createAlertBtn.addEventListener('click', function() {
    window.location.href = `create-alert.html?personId=${personId}`;
  });
  
  filterStatus.addEventListener('change', function() {
    renderAlerts(alerts);
  });
  
  cancelDeleteBtn.addEventListener('click', function() {
    deleteModal.style.display = 'none';
    alertToDelete = null;
  });
  
  confirmDeleteBtn.addEventListener('click', handleDelete);
}

// =============================================================================
// Load Alerts
// =============================================================================

async function loadAlerts() {
  try {
    const response = await fetch(`/api/alerts?personId=${personId}`);
    
    if (!response.ok) {
      throw new Error('Failed to load alerts');
    }
    
    const data = await response.json();
    alerts = data.alerts || [];
    
    console.log(`Loaded ${alerts.length} alerts`);
    
    updateSummaryCards();
    renderAlerts(alerts);
    
  } catch (error) {
    console.error('Error loading alerts:', error);
    alertsList.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #e74c3c;">
        <p>Failed to load alerts. Please refresh the page.</p>
      </div>
    `;
  }
}

// =============================================================================
// Update Summary Cards
// =============================================================================

function updateSummaryCards() {
  const activeAlerts = alerts.filter(a => a.active).length;
  const totalMatches = alerts.reduce((sum, a) => sum + (a.metadata?.lastMatchCount || 0), 0);
  
  document.getElementById('totalAlerts').textContent = activeAlerts;
  document.getElementById('todayMatches').textContent = totalMatches;
}

// =============================================================================
// Render Alerts
// =============================================================================

function renderAlerts(alertsToRender) {
  // Apply filter
  const filter = filterStatus.value;
  let filtered = alertsToRender;
  
  if (filter === 'active') {
    filtered = alertsToRender.filter(a => a.active);
  } else if (filter === 'paused') {
    filtered = alertsToRender.filter(a => !a.active);
  }
  
  // Show empty state if no alerts
  if (filtered.length === 0) {
    alertsList.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }
  
  // Render alerts
  alertsList.style.display = 'flex';
  emptyState.style.display = 'none';
  
  alertsList.innerHTML = filtered.map(alert => createAlertCard(alert)).join('');
  
  // Attach event listeners
  filtered.forEach(alert => {
    attachAlertListeners(alert.alertId);
  });
}

// =============================================================================
// Create Alert Card HTML
// =============================================================================

function createAlertCard(alert) {
  const isActive = alert.active;
  const lastRun = alert.metadata?.lastRunAt 
    ? new Date(alert.metadata.lastRunAt).toLocaleString()
    : 'Never';
  const matchCount = alert.metadata?.lastMatchCount || 0;
  
  const contentTypes = alert.searchParams?.contentTypes || [];
  const contentTypeTags = contentTypes.map(type => 
    `<span class="tag">${type}</span>`
  ).join('');
  
  return `
    <div class="alert-card ${isActive ? '' : 'paused'}" data-alert-id="${alert.alertId}">
      <div class="alert-card-header">
        <div class="alert-title-section">
          <h3>
            ${alert.alertName}
            <span class="status-badge ${isActive ? 'active' : 'paused'}">
              ${isActive ? 'Active' : 'Paused'}
            </span>
          </h3>
          <div class="alert-meta">
            Company: <strong>${alert.memberName}</strong> | 
            Created: ${new Date(alert.metadata?.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div class="alert-actions">
          <button class="btn-icon" data-action="run" data-alert-id="${alert.alertId}" title="Run Now">
            ▶️
          </button>
          <button class="btn-icon" data-action="toggle" data-alert-id="${alert.alertId}" title="${isActive ? 'Pause' : 'Resume'}">
            ${isActive ? '⏸️' : '▶️'}
          </button>
          <button class="btn-icon danger" data-action="delete" data-alert-id="${alert.alertId}" title="Delete">
            🗑️
          </button>
        </div>
      </div>

      <div class="alert-details">
        <div class="detail-row">
          <div class="detail-label">Search:</div>
          <div class="detail-value">"${alert.searchParams?.phrase || 'N/A'}"</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Content Types:</div>
          <div class="detail-value">${contentTypeTags || 'All types'}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Smart Match:</div>
          <div class="detail-value">
            ${alert.useSmartMatch 
              ? '<span class="check-icon">✓</span> Enabled' 
              : '<span class="x-icon">✗</span> Disabled'}
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Date Filter:</div>
          <div class="detail-value">
            <span style="color: #3498db;">📅 Auto (today only)</span>
          </div>
        </div>
      </div>

      <div class="alert-activity">
        <div class="activity-header">Recent Activity</div>
        <div class="activity-stats">
          <div class="activity-item">
            Last run: <strong>${lastRun}</strong>
          </div>
          <div class="activity-item">
            <span class="activity-highlight">${matchCount} matches found</span>
          </div>
        </div>
        <div class="activity-note">
          📧 Included in daily digest to ${alert.emailSettings?.recipientEmail}
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// Attach Alert Action Listeners
// =============================================================================

function attachAlertListeners(alertId) {
  const card = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (!card) return;
  
  const runBtn = card.querySelector('[data-action="run"]');
  const toggleBtn = card.querySelector('[data-action="toggle"]');
  const deleteBtn = card.querySelector('[data-action="delete"]');
  
  if (runBtn) runBtn.addEventListener('click', () => handleRun(alertId));
  if (toggleBtn) toggleBtn.addEventListener('click', () => handleToggle(alertId));
  if (deleteBtn) deleteBtn.addEventListener('click', () => showDeleteModal(alertId));
}

// =============================================================================
// Alert Actions
// =============================================================================

async function handleRun(alertId) {
  if (!confirm('Run this alert now? It will check for today\'s matches.')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/alerts/${alertId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ personId: personId })
    });
    
    if (!response.ok) {
      throw new Error('Failed to run alert');
    }
    
    const result = await response.json();
    
    alert(`Alert run complete!\n\nFound ${result.matchCount} matches.\nEmail ${result.emailSent ? 'sent' : 'not sent'}.`);
    
    loadAlerts(); // Refresh
    
  } catch (error) {
    console.error('Error running alert:', error);
    alert(`Failed to run alert: ${error.message}`);
  }
}

async function handleToggle(alertId) {
  const alert = alerts.find(a => a.alertId === alertId);
  if (!alert) return;
  
  const newStatus = !alert.active;
  
  try {
    const response = await fetch(`/api/alerts/${alertId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personId: personId,
        active: newStatus
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to update alert');
    }
    
    console.log(`Alert ${alertId} ${newStatus ? 'activated' : 'paused'}`);
    
    loadAlerts(); // Refresh
    
  } catch (error) {
    console.error('Error updating alert:', error);
    alert(`Failed to update alert: ${error.message}`);
  }
}

function showDeleteModal(alertId) {
  const alert = alerts.find(a => a.alertId === alertId);
  if (!alert) return;
  
  alertToDelete = alertId;
  deleteAlertName.textContent = alert.alertName;
  deleteModal.style.display = 'flex';
}

async function handleDelete() {
  if (!alertToDelete) return;
  
  try {
    const response = await fetch(`/api/alerts/${alertToDelete}?personId=${personId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete alert');
    }
    
    console.log(`Alert ${alertToDelete} deleted`);
    
    deleteModal.style.display = 'none';
    alertToDelete = null;
    
    loadAlerts(); // Refresh
    
  } catch (error) {
    console.error('Error deleting alert:', error);
    alert(`Failed to delete alert: ${error.message}`);
  }
}

console.log('Alerts Dashboard JS loaded');
