// =============================================================================
// MIT Brain Alert Creator - JavaScript
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
const form = document.getElementById('alertForm');
const memberSelect = document.getElementById('memberSelect');
const smartMatchToggle = document.getElementById('smartMatchToggle');
const smartMatchCheckbox = document.getElementById('useSmartMatch');
const smartMatchWarning = document.getElementById('smartMatchWarning');
const loadingOverlay = document.getElementById('loadingOverlay');
const successModal = document.getElementById('successModal');
const cancelBtn = document.getElementById('cancelBtn');
const testAlertBtn = document.getElementById('testAlertBtn');
const viewAlertsBtn = document.getElementById('viewAlertsBtn');
const createAnotherBtn = document.getElementById('createAnotherBtn');

// =============================================================================
// Initialize
// =============================================================================

document.addEventListener('DOMContentLoaded', async function() {
  await detectPersonId();
  console.log('Alert Creator initialized for personId:', personId);
  
  loadMembers();
  setupEventListeners();
});

// =============================================================================
// Load Members/Companies
// =============================================================================

async function loadMembers() {
  try {
    const response = await fetch(`/api/members?personId=${personId}`);
    
    if (!response.ok) {
      throw new Error('Failed to load members');
    }
    
    const members = await response.json();
    
    // Populate dropdown
    memberSelect.innerHTML = '<option value="">Select a company...</option>';
    
    members.forEach(member => {
      const option = document.createElement('option');
      option.value = member.memberName;
      option.textContent = member.memberName;
      option.dataset.member = JSON.stringify(member);
      memberSelect.appendChild(option);
    });
    
    console.log(`Loaded ${members.length} members`);
    
  } catch (error) {
    console.error('Error loading members:', error);
    alert('Failed to load companies. Please refresh the page.');
  }
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupEventListeners() {
  // Smart Match toggle
  smartMatchCheckbox.addEventListener('change', function() {
    if (this.checked) {
      smartMatchToggle.classList.add('active');
      smartMatchWarning.style.display = 'none';
    } else {
      smartMatchToggle.classList.remove('active');
      smartMatchWarning.style.display = 'block';
    }
  });
  
  // Form submission
  form.addEventListener('submit', handleSubmit);
  
  // Cancel button
  cancelBtn.addEventListener('click', function() {
    if (confirm('Are you sure you want to cancel? All changes will be lost.')) {
      window.location.href = '/alerts-dashboard.html';
    }
  });
  
  // Test alert button
  testAlertBtn.addEventListener('click', handleTestAlert);
  
  // Success modal buttons
  viewAlertsBtn.addEventListener('click', function() {
    window.location.href = '/alerts-dashboard.html';
  });
  
  createAnotherBtn.addEventListener('click', function() {
    successModal.style.display = 'none';
    form.reset();
    memberSelect.selectedIndex = 0;
    smartMatchCheckbox.checked = true;
    smartMatchToggle.classList.add('active');
    smartMatchWarning.style.display = 'none';
  });
}

// =============================================================================
// Form Submission
// =============================================================================

async function handleSubmit(e) {
  e.preventDefault();
  
  // Validate form
  if (!validateForm()) {
    return;
  }
  
  // Get form data
  const formData = getFormData();
  
  console.log('Creating alert:', formData);
  
  // Show loading
  loadingOverlay.style.display = 'flex';
  
  try {
    const response = await fetch('/api/alerts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create alert');
    }
    
    const result = await response.json();
    console.log('Alert created:', result);
    
    // Hide loading, show success
    loadingOverlay.style.display = 'none';
    successModal.style.display = 'flex';
    
  } catch (error) {
    loadingOverlay.style.display = 'none';
    console.error('Error creating alert:', error);
    alert(`Failed to create alert: ${error.message}`);
  }
}

// =============================================================================
// Form Validation
// =============================================================================

function validateForm() {
  // Check required fields
  const alertName = document.getElementById('alertName').value.trim();
  const memberName = memberSelect.value;
  const searchPhrase = document.getElementById('searchPhrase').value.trim();
  const recipientEmail = document.getElementById('recipientEmail').value.trim();
  
  if (!alertName) {
    alert('Please enter an alert name');
    document.getElementById('alertName').focus();
    return false;
  }
  
  if (!memberName) {
    alert('Please select a company');
    memberSelect.focus();
    return false;
  }
  
  if (!searchPhrase) {
    alert('Please enter search keywords');
    document.getElementById('searchPhrase').focus();
    return false;
  }
  
  if (!recipientEmail) {
    alert('Please enter an email address');
    document.getElementById('recipientEmail').focus();
    return false;
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    alert('Please enter a valid email address');
    document.getElementById('recipientEmail').focus();
    return false;
  }
  
  // Check at least one content type selected
  const contentTypes = Array.from(document.querySelectorAll('input[name="contentTypes"]:checked'));
  if (contentTypes.length === 0) {
    alert('Please select at least one content type');
    return false;
  }
  
  return true;
}

// =============================================================================
// Get Form Data
// =============================================================================

function getFormData() {
  const selectedMemberOption = memberSelect.options[memberSelect.selectedIndex];
  const memberProfile = JSON.parse(selectedMemberOption.dataset.member);
  
  const contentTypes = Array.from(document.querySelectorAll('input[name="contentTypes"]:checked'))
    .map(cb => cb.value);
  
  return {
    personId: personId,
    alertName: document.getElementById('alertName').value.trim(),
    memberName: memberSelect.value,
    memberProfile: memberProfile,
    searchParams: {
      phrase: document.getElementById('searchPhrase').value.trim(),
      minScore: parseFloat(document.getElementById('minScore').value),
      contentTypes: contentTypes
      // NOTE: No dateFrom/dateTo - handled automatically by backend
    },
    emailSettings: {
      recipientEmail: document.getElementById('recipientEmail').value.trim(),
      frequency: document.getElementById('frequency').value
    },
    useSmartMatch: smartMatchCheckbox.checked
  };
}

// =============================================================================
// Test Alert
// =============================================================================

async function handleTestAlert() {
  if (!validateForm()) {
    return;
  }
  
  if (!confirm('This will run the alert once and send a test email. Continue?')) {
    return;
  }
  
  const formData = getFormData();
  
  console.log('Testing alert:', formData);
  
  loadingOverlay.style.display = 'flex';
  
  try {
    // First create the alert
    const createResponse = await fetch('/api/alerts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    if (!createResponse.ok) {
      throw new Error('Failed to create alert');
    }
    
    const createResult = await createResponse.json();
    const alertId = createResult.alertId;
    
    // Then run it
    const runResponse = await fetch(`/api/alerts/${alertId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ personId: personId })
    });
    
    if (!runResponse.ok) {
      throw new Error('Failed to run alert');
    }
    
    const runResult = await runResponse.json();
    
    loadingOverlay.style.display = 'none';
    
    alert(`Test complete!\n\nFound ${runResult.matchCount} matches.\nEmail ${runResult.emailSent ? 'sent' : 'not sent'}.`);
    
  } catch (error) {
    loadingOverlay.style.display = 'none';
    console.error('Error testing alert:', error);
    alert(`Test failed: ${error.message}`);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

// Auto-save draft to localStorage (optional enhancement)
function saveDraft() {
  const draft = {
    alertName: document.getElementById('alertName').value,
    memberName: memberSelect.value,
    searchPhrase: document.getElementById('searchPhrase').value,
    minScore: document.getElementById('minScore').value,
    recipientEmail: document.getElementById('recipientEmail').value,
    useSmartMatch: smartMatchCheckbox.checked,
    timestamp: new Date().toISOString()
  };
  
  localStorage.setItem('alertDraft', JSON.stringify(draft));
}

// Load draft from localStorage (optional enhancement)
function loadDraft() {
  const draft = localStorage.getItem('alertDraft');
  if (draft) {
    try {
      const data = JSON.parse(draft);
      
      // Only load if recent (within 24 hours)
      const draftAge = Date.now() - new Date(data.timestamp).getTime();
      if (draftAge < 24 * 60 * 60 * 1000) {
        document.getElementById('alertName').value = data.alertName || '';
        memberSelect.value = data.memberName || '';
        document.getElementById('searchPhrase').value = data.searchPhrase || '';
        document.getElementById('minScore').value = data.minScore || '1.0';
        document.getElementById('recipientEmail').value = data.recipientEmail || '';
        smartMatchCheckbox.checked = data.useSmartMatch !== false;
        
        console.log('Loaded draft from localStorage');
      }
    } catch (e) {
      console.error('Failed to load draft:', e);
    }
  }
}

// Clear draft
function clearDraft() {
  localStorage.removeItem('alertDraft');
}

// Auto-save every 30 seconds (optional)
// setInterval(saveDraft, 30000);

console.log('Alert Creator JS loaded');
