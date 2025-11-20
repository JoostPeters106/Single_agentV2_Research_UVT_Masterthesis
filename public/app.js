const chatInput = document.getElementById('chat-input');
const runButton = document.getElementById('chat-send');
const chatThread = document.getElementById('chat-thread');
const chatForm = document.getElementById('chat-bar');
const restartButton = document.getElementById('restartFlow');

function scrollChatToBottom(options = {}) {
  if (!chatThread) return;
  const { smooth = false } = options;
  const canSmoothScroll = typeof chatThread.scrollTo === 'function';
  if (canSmoothScroll) {
    chatThread.scrollTo({
      top: chatThread.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  } else {
    chatThread.scrollTop = chatThread.scrollHeight;
  }
}

const ROLE_INFO = {
  agent1: {
    name: 'Sales Agent 1',
    role: 'Recommender',
    badgeClass: 'blue',
    avatar: 'A1',
    alignment: 'left',
    bubbleClass: 'agent'
  },
  system: {
    name: 'System',
    role: null,
    badgeClass: 'system',
    avatar: 'SYS',
    alignment: 'left',
    bubbleClass: 'system'
  }
};

if (restartButton) {
  restartButton.addEventListener('click', () => {
    resetChat({ message: 'Conversation reset. Submit a new prompt to begin.' });
    if (chatInput) {
      chatInput.value = '';
      chatInput.disabled = false;
      autoSizeChatInput();
    }
    if (runButton) {
      runButton.disabled = false;
    }
    if (chatThread) {
      chatThread.setAttribute('aria-busy', 'false');
    }

    restartButton.classList.remove('restart-triggered');
    // Force a reflow so repeated clicks retrigger the animation class
    void restartButton.offsetWidth;
    restartButton.classList.add('restart-triggered');
    setTimeout(() => {
      restartButton.classList.remove('restart-triggered');
    }, 650);
  });
}

if (chatThread) {
  resetChat();
}

if (chatInput) {
  autoSizeChatInput();
  chatInput.addEventListener('input', autoSizeChatInput);
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (runButton.disabled) return;
  await executeFlow();
});

function autoSizeChatInput() {
  if (!chatInput) return;
  chatInput.style.height = 'auto';
  const maxHeight = 140;
  const next = Math.min(chatInput.scrollHeight, maxHeight);
  chatInput.style.height = `${next}px`;
}

async function executeFlow() {
  const question = chatInput.value.trim();

  if (!question) {
    addSystemMessage('Please provide a question to run the flow.');
    return;
  }

  chatInput.value = '';
  autoSizeChatInput();

  resetChat();
  const clearValidation = addSystemMessage('Validating question…', { ephemeral: true });
  runButton.disabled = true;
  chatInput.disabled = true;
  chatThread.setAttribute('aria-busy', 'true');

  try {
    const validateRes = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });

    const validateData = await validateRes.json();

    if (!validateRes.ok || !validateData.allowed) {
      clearValidation();
      addSystemMessage(validateData.message || 'Validation failed.');
      return;
    }

    clearValidation();
    const typing1Done = showTyping('agent1', 1);
    const agent1 = await postJSON('/api/agent1', { question });
    typing1Done();
    const cappedSummary = applyWordCap(agent1.summary, 80);
    const baseSummary = cappedSummary || 'no recommendations available at this time.';
    const revisitSummary = buildRevisitSummary(baseSummary, agent1.bullets);
    addMessage({
      role: 'agent1',
      turn: 1,
      heading: 'Recommendation',
      reply: null,
      summary: `My initial suggestion is ${baseSummary}`,
      bullets: agent1.bullets,
      allowCopy: true
    });
    const revisitTypingDone = showTyping('agent1', 2, {
      label: 'Sales Agent 1 · Turn 2 is revisiting the recommendation'
    });
    await wait(1500);
    revisitTypingDone();
    addMessage({
      role: 'agent1',
      turn: 2,
      heading: 'Revisit',
      reply: null,
      summary: revisitSummary,
      bullets: agent1.bullets,
      allowCopy: true
    });
    addSystemMessage('Flow completed successfully.');
  } catch (err) {
    console.error(err);
    clearValidation();
    addSystemMessage('An error occurred while running the flow.');
  } finally {
    runButton.disabled = false;
    chatInput.disabled = false;
    chatThread.setAttribute('aria-busy', 'false');
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizePriorities(bullets = []) {
  const items = Array.isArray(bullets) ? bullets.filter(Boolean).slice(0, 3) : [];
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(', ');
  const tail = items[items.length - 1];
  return `${head} and ${tail}`;
}

function buildRevisitSummary(baseSummary = '', bullets = []) {
  const prioritized = summarizePriorities(bullets);
  const trimmedSummary = baseSummary.trim();

  if (prioritized) {
    const prefix = trimmedSummary
      ? `Revisiting the first suggestion ("${trimmedSummary}"), the data still points to ${prioritized}`
      : `After reflecting on the data, ${prioritized} remain the strongest candidates`;
  }
  if (trimmedSummary) {
    return `after reassessing the initial recommendation ("${trimmedSummary}"), stay with that prioritization because it best fits the evidence.`;
  }
  return 'after reflecting on the available data, continue with the suggested priorities.';
}

function resetChat({ message } = {}) {
  chatThread.innerHTML = '';
  chatThread.setAttribute('aria-busy', 'false');
  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder';
  placeholder.textContent = message || 'Run the flow to see the recommendation.';
  chatThread.appendChild(placeholder);
}

function ensureChatReady() {
  const placeholder = chatThread.querySelector('.placeholder');
  if (placeholder) {
    placeholder.remove();
  }
}

function showTyping(role, turn, { label: customLabel } = {}) {
  ensureChatReady();
  chatThread.setAttribute('aria-busy', 'true');
  const info = ROLE_INFO[role];
  const row = document.createElement('div');
  row.className = ['msg', info ? info.bubbleClass : 'system', info ? info.alignment : 'left', 'typing']
    .filter(Boolean)
    .join(' ');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = info?.avatar || '…';
  row.appendChild(avatar);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const descriptor = [];
  if (info?.name) descriptor.push(info.name);
  if (turn) descriptor.push(`Turn ${turn}`);
  const label = customLabel || `${descriptor.length ? descriptor.join(' · ') : 'Agent'} is drafting`;
  bubble.textContent = label;

  const dots = document.createElement('span');
  dots.className = 'typing-dots';
  for (let i = 0; i < 3; i += 1) {
    dots.appendChild(document.createElement('span'));
  }
  bubble.appendChild(dots);

  row.appendChild(bubble);
  chatThread.appendChild(row);
  scrollChatToBottom();

  return () => {
    row.remove();
    if (!chatThread.querySelector('.typing')) {
      chatThread.setAttribute('aria-busy', 'false');
    }
  };
}

function addMessage({ role, turn, heading, reply, summary, bullets = [], allowCopy = false }) {
  ensureChatReady();
  const info = ROLE_INFO[role] || ROLE_INFO.agent1;

  const row = document.createElement('div');
  const isCompactMessage = role === 'agent1';
  row.className = ['msg', info.bubbleClass || '', info.alignment || 'left', isCompactMessage ? 'compact' : '']
    .filter(Boolean)
    .join(' ');

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = info.avatar || info.name.charAt(0);
  row.appendChild(avatar);

  const bubble = document.createElement('article');
  bubble.className = ['bubble', isCompactMessage ? 'compact' : ''].filter(Boolean).join(' ');

  const header = document.createElement('header');
  const badge = document.createElement('span');
  badge.className = ['badge', info.badgeClass || ''].join(' ').trim();
  badge.textContent = info.name;
  header.appendChild(badge);

  const descriptors = [];
  if (info.role) descriptors.push(info.role);
  if (turn) descriptors.push(`Turn ${turn}`);
  if (heading) descriptors.push(heading);
  if (descriptors.length) {
    const meta = document.createElement('span');
    meta.textContent = descriptors.join(' · ');
    header.appendChild(meta);
  }

  if (reply) {
    const replySpan = document.createElement('span');
    replySpan.textContent = reply;
    header.appendChild(replySpan);
  }

  bubble.appendChild(header);

  const body = buildMessageBody(summary, bullets);
  bubble.appendChild(body);

  row.appendChild(bubble);
  chatThread.appendChild(row);
  scrollChatToBottom();


}

function buildMessageBody(summary = '', bullets = []) {
  const container = document.createElement('div');
  container.className = 'body';
  const safeSummary = summary && summary.trim().length > 0 ? summary.trim() : 'No summary provided.';
  const paragraph = document.createElement('p');
  paragraph.textContent = safeSummary;
  container.appendChild(paragraph);

  const bulletList = Array.isArray(bullets) ? bullets.filter(Boolean) : [];
  if (bulletList.length) {
    const ul = document.createElement('ul');
    bulletList.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  return container;
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Request to ${url} failed.`);
  }

  return res.json();
}

function addSystemMessage(message, { ephemeral = false } = {}) {
  ensureChatReady();
  const info = ROLE_INFO.system;
  const row = document.createElement('div');
  row.className = ['msg', info.bubbleClass, info.alignment, 'system-message'].filter(Boolean).join(' ');
  if (ephemeral) {
    row.dataset.ephemeral = 'true';
  }

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = info.avatar;
  row.appendChild(avatar);

  const bubble = document.createElement('article');
  bubble.className = 'bubble';

  const header = document.createElement('header');
  const badge = document.createElement('span');
  badge.className = ['badge', info.badgeClass].join(' ');
  badge.textContent = info.name;
  header.appendChild(badge);
  bubble.appendChild(header);

  const body = document.createElement('div');
  body.className = 'body';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  body.appendChild(paragraph);
  bubble.appendChild(body);

  row.appendChild(bubble);
  chatThread.appendChild(row);
  scrollChatToBottom();

  if (ephemeral) {
    return () => {
      row.remove();
    };
  }

  return () => {};
}

function applyWordCap(text = '', limit = 80) {
  if (!text) return '';
  const words = text.trim().split(/\s+/);
  if (words.length <= limit) {
    return text.trim();
  }
  const truncated = words.slice(0, limit).join(' ');
  return `${truncated}…`;
}

async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // fall back to legacy copy
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (error) {
    success = false;
  }

  document.body.removeChild(textarea);
  return success;
}

resetChat();
