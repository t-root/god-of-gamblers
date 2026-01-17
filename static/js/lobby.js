// Lobby JavaScript
const socket = io();
let currentRoom = null;
let currentRoomId = null;

// DOM Elements
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomId');
const maxBoostsSelect = document.getElementById('maxBoosts');
const roomCreatedSection = document.getElementById('roomCreatedSection');
const copyRoomIdBtn = document.getElementById('copyRoomIdBtn');
const copyRoomUrlBtn = document.getElementById('copyRoomUrlBtn');
const enterRoomBtn = document.getElementById('enterRoomBtn');
const toast = document.getElementById('toast');

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Auto-format room ID to uppercase on input
    roomIdInput.addEventListener('input', function() {
        // Store current cursor position
        const cursorPos = this.selectionStart;
        const cursorEnd = this.selectionEnd;

        // Convert to uppercase
        this.value = this.value.toUpperCase();

        // Restore cursor position
        this.setSelectionRange(cursorPos, cursorEnd);
    });

    // Add keydown validation to prevent invalid characters
    roomIdInput.addEventListener('keydown', function(e) {
        // Allow control keys (backspace, delete, arrows, etc.)
        if (e.ctrlKey || e.altKey || e.metaKey ||
            e.key.length > 1 ||
            e.key === 'Backspace' ||
            e.key === 'Delete' ||
            e.key === 'Tab' ||
            e.key === 'Enter' ||
            e.key === 'Escape') {
            return;
        }

        // Only allow A-Z and 0-9
        const allowedChars = /^[A-Z0-9]$/i;
        if (!allowedChars.test(e.key)) {
            e.preventDefault();
            showToast('Chỉ được nhập chữ cái và số!', 'warning');
        }
    });

    setupEventListeners();

    // Check if user has a stored player ID for reconnection
    const storedPlayerId = localStorage.getItem('gamePlayerId');
    if (!storedPlayerId) {
        // Generate a new player ID
        const newPlayerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('gamePlayerId', newPlayerId);
    }
});

// Event Listeners
function setupEventListeners() {
    // Create room
    createRoomBtn.addEventListener('click', createRoom);

    // Join room
    joinRoomBtn.addEventListener('click', joinRoom);

    // Room actions
    if (enterRoomBtn) enterRoomBtn.addEventListener('click', enterRoom);
    copyRoomIdBtn.addEventListener('click', copyRoomId);
    copyRoomUrlBtn.addEventListener('click', copyRoomUrl);
}

// Create Room
function createRoom() {
    const mode = parseInt(document.querySelector('input[name="mode"]:checked').value);
    const maxBoosts = parseInt(maxBoostsSelect.value);
    const decks = parseInt(document.querySelector('input[name="decks"]:checked').value);

    socket.emit('create_room', {
        mode: mode,
        max_boosts: maxBoosts,
        decks: decks
    });
}

// Join Room
function joinRoom() {
    const roomId = roomIdInput.value.trim();

    if (!roomId) {
        showToast('Vui lòng nhập ID phòng!', 'error');
        roomIdInput.focus();
        return;
    }

    // Validate room ID: exactly 6 characters, alphanumeric only
    if (roomId.length !== 6) {
        showToast('ID phòng phải có đúng 6 ký tự!', 'error');
        roomIdInput.focus();
        return;
    }

    if (!/^[A-Z0-9]{6}$/.test(roomId)) {
        showToast('ID phòng chỉ được chứa chữ cái và số (A-Z, 0-9)!', 'error');
        roomIdInput.focus();
        return;
    }

    const playerId = localStorage.getItem('gamePlayerId');

    socket.emit('join_room', {
        room_id: roomId,
        player_id: playerId
    });
}

// Copy Room ID
function copyRoomId() {
    if (!currentRoomId) {
        showToast('Không có thông tin phòng!', 'error');
        return;
    }

    navigator.clipboard.writeText(currentRoomId).then(() => {
        showToast('Đã sao chép ID phòng!', 'success');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = currentRoom;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('Đã sao chép ID phòng!', 'success');
    });
}

// Enter Room
function enterRoom() {
    if (!currentRoomId) {
        showToast('Không có thông tin phòng!', 'error');
        return;
    }

    showToast('Đang chuyển hướng...', 'info');
    window.location.href = `/${currentRoomId}`;
}

// Copy Room URL
function copyRoomUrl() {
    if (!currentRoomId) {
        showToast('Không có thông tin phòng!', 'error');
        return;
    }

    const url = `${window.location.origin}/${currentRoomId}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Đã sao chép URL phòng!', 'success');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('Đã sao chép URL phòng!', 'success');
    });
}

// Socket Event Handlers
socket.on('room_created', function(data) {
    currentRoom = data.room_id;
    showRoomInfo(data);
    showToast(`Phòng ${data.room_id} đã được tạo!`, 'success');
});

socket.on('room_joined', function(data) {
    currentRoom = data.room_id;
    showRoomInfo(data);
    showToast(`Đã tham gia phòng ${data.room_id}!`, 'success');
});


socket.on('game_started', function(data) {
    // Redirect to game page
    window.location.href = `/${currentRoom}`;
});

socket.on('error', function(data) {
    showToast(data.message, 'error');
});

// UI Functions
function showRoomInfo(data) {
    // Hide create/join forms and show room info
    document.querySelector('.lobby-content').style.display = 'none';
    // Store current room info
    currentRoomId = data.room_id;
    currentRoom = data.room_id; // Keep for backward compatibility

    roomCreatedSection.style.display = 'block';

    document.getElementById('roomIdDisplay').textContent = data.room_id;
    document.getElementById('roomModeDisplay').textContent = `${data.mode} lá bài`;
    document.getElementById('roomBoostDisplay').textContent = `${data.max_boosts} lần`;
}


function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Auto-hide toast when clicked
toast.addEventListener('click', function() {
    this.classList.remove('show');
});
