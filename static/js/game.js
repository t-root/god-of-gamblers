// Multiplayer Game JavaScript - Independent gameplay with shared card usage
const socket = io();

// Log client timezone info

// Socket event handlers (register immediately)
socket.on('connect', function() {
    joinCurrentRoom();
});

socket.on('disconnect', function() {
});

socket.on('reconnect', function() {
    joinCurrentRoom();
});

// Clear join timeout on any socket error to prevent unwanted reloads
socket.on('connect_error', function() {
    if (joinTimeout) {
        clearTimeout(joinTimeout);
        joinTimeout = null;
    }
});
let gameState = {
    mode: 3, // 3 or 6 cards
    cards: [],
    selectedCardIndex: -1,
    boostTargetIndex: -1,
    boostUsed: false,
    chantCount: 0,
    currentTranscript: '',
    isRecognitionActive: false,
    isRecognitionStopping: false, // Track if recognition is in the process of stopping
    swapCount: 0,
    energy: 0,
    isSwapping: false,
    isBoosting: false,
    isSelectingCard: false,
    desiredCard: null,
    usedCards: [], // Cards used by anyone in the room
    folded: false,
    allFolded: false,
    readyForNewRound: false,
    touchPoints: [],
    touchThreshold: 20,
    baseEnergyPerMove: 0.08,
    lastX: {},
    lastY: {},
    lastMoveTime: {},
    moveSpeeds: {},
    energyDecreaseRate: 3.5,
    energyDecreaseInterval: null,
    speedUpdateInterval: null,
    averageSpeed: 0,
    requiredEnergyForSwap: 100,
    minFingersRequired: 4,
    fingersTouching: 0,
    roomId: ROOM_ID,
    playerId: null,
    maxBoosts: 3,
    totalSwaps: 0,
    swapLimitReached: false,
    currentBoostPercent: 1,
    flippedCards: [],
    shakeThreshold: 15,
    shakeCount: 0,
    shakeMode: false,
    lastAcceleration: { x: 0, y: 0, z: 0 },
    // Drag & drop states
    isDragging: false,
    draggedCard: null,
    draggedCardIndex: -1,
    dragOffset: { x: 0, y: 0 },
    ghostCard: null,
    dragStartTime: 0,
    isPotentialDrag: false,
    // Speech recognition states
    // (simplified - no complex flags needed)
};

// DOM Elements
const cardsContainer = document.getElementById('cardsContainer');
const swapBtn = document.getElementById('swapBtn');
const boostBtn = document.getElementById('boostBtn');
const resetBtn = document.getElementById('resetBtn');
const foldBtn = document.getElementById('foldBtn');
const newRoundBtn = document.getElementById('newRoundBtn');
const roundControls = document.getElementById('roundControls');
const newRoundTriggerBtn = document.getElementById('newRoundTriggerBtn');
const newRoundPopup = document.getElementById('newRoundPopup');
const closeNewRoundPopup = document.getElementById('closeNewRoundPopup');
const readyProgressFill = document.getElementById('readyProgressFill');
const readyProgressText = document.getElementById('readyProgressText');
const readyStatusList = document.getElementById('readyStatusList');
const readyCountDisplay = document.getElementById('readyCount');
const totalPlayersDisplay = document.getElementById('totalPlayers');
const foldedCountDisplay = document.getElementById('foldedCount');
const timerDisplay = document.getElementById('timer');
const energyFill = document.getElementById('energyFill');
const energyPercent = document.getElementById('energyPercent');
const overlayEnergyFill = document.getElementById('overlayEnergyFill');
const overlayEnergyPercent = document.getElementById('overlayEnergyPercent');
const boostInfo = document.getElementById('boostInfo');
const boostChanceDisplay = document.getElementById('boostChance');
const swapsRemainingDisplay = document.getElementById('swapsRemaining');

// Helper functions

// Card selection popup elements
const cardValueDropdown = document.getElementById('cardValueDropdown');
const confirmCardSelection = document.getElementById('confirmCardSelection');
const cancelCardSelection = document.getElementById('cancelCardSelection');
const chantBubbles = [document.getElementById('chant1'), document.getElementById('chant2'), document.getElementById('chant3')];
const chantInstruction = document.getElementById('chantInstruction');
const speechDisplay = document.getElementById('speechDisplay');
const speechText = document.getElementById('speechText');
const speechOkBtn = document.getElementById('speechOkBtn');
const toast = document.getElementById('toast');
const speedDisplay = document.getElementById('speedDisplay');
const overlaySpeedDisplay = document.getElementById('overlaySpeedDisplay');
const fingerCount = document.getElementById('fingerCount');
const overlayFingerCount = document.getElementById('overlayFingerCount');

// Deck suggestion popup elements
const deckSuggestionPopup = document.getElementById('deckSuggestionPopup');
const dismissDeckSuggestion = document.getElementById('dismissDeckSuggestion');
const dontShowDeckSuggestion = document.getElementById('dontShowDeckSuggestion');
const remainingCardsCount = document.getElementById('remainingCardsCount');
const closeBoostInfo = document.getElementById('closeBoostInfo');

// Card selection elements

// Speech recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    requestMicrophonePermission().then(() => {
        initSpeechRecognition();
    }).catch((error) => {
        console.warn('Microphone permission denied or failed:', error);
        // Still init speech recognition but it will show error when used
        initSpeechRecognition();
    });
    initShakeDetection();
    initCardDragDrop();
});

// Check if socket is already connected (page refresh scenario)
document.addEventListener('DOMContentLoaded', function() {
    if (socket.connected) {
        joinCurrentRoom();
    }
});

// Clear timeouts on page unload
window.addEventListener('beforeunload', function() {
    if (joinTimeout) {
        clearTimeout(joinTimeout);
        joinTimeout = null;
    }
});

let joinTimeout = null;

function joinCurrentRoom() {
    // Join room automatically
    let playerId = localStorage.getItem('gamePlayerId');
    if (!playerId) {
        playerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('gamePlayerId', playerId);
    }


    socket.emit('join_room', {
        room_id: ROOM_ID,
        player_id: playerId
    });
 

    // Set timeout for auto-reload if game doesn't start within 5 seconds
    if (joinTimeout) clearTimeout(joinTimeout);
    joinTimeout = setTimeout(() => { 
            window.location.reload(); 
    }, 1000);
}

// Event Listeners
function setupEventListeners() {
    // Game controls
    if (swapBtn) swapBtn.addEventListener('click', startSwap);
    if (boostBtn) boostBtn.addEventListener('click', startBoost);
    if (resetBtn) resetBtn.addEventListener('click', resetGame);
    if (foldBtn) foldBtn.addEventListener('click', fold);

    // Reveal cards button
    const revealCardsBtn = document.getElementById('revealCardsBtn');
    if (revealCardsBtn) {
        revealCardsBtn.addEventListener('click', function() {
            revealAllCards();
        });
    } else {
    }

    // New round popup
    if (newRoundTriggerBtn) newRoundTriggerBtn.addEventListener('click', showNewRoundPopup);
    if (closeNewRoundPopup) closeNewRoundPopup.addEventListener('click', hideNewRoundPopup);

    if (newRoundBtn) newRoundBtn.addEventListener('click', readyForNewRound);

    // Speech controls
    if (speechOkBtn) speechOkBtn.addEventListener('click', confirmSpeechText);

    // Card selection popup
    if (confirmCardSelection) {
        confirmCardSelection.addEventListener('click', function(e) {
            if (typeof performBoostSwap === 'function') {
                performBoostSwap();
            } else {
                console.error('performBoostSwap is not a function!');
            }
        });
    } else {
        console.error('confirmCardSelection element not found');
    }
    if (cancelCardSelection) cancelCardSelection.addEventListener('click', hideCardSelectionOverlay);
    if (cardValueDropdown) {
        cardValueDropdown.addEventListener('change', function() {
            confirmCardSelection.disabled = !this.value;
        });
    }

    // Deck suggestion popup
    if (dismissDeckSuggestion) dismissDeckSuggestion.addEventListener('click', hideDeckSuggestionPopup);
    if (dontShowDeckSuggestion) dontShowDeckSuggestion.addEventListener('click', dontShowDeckSuggestionAgain);

    // Boost info popup close button
    if (closeBoostInfo) closeBoostInfo.addEventListener('click', function() {
        gameState.isBoosting = false;
        boostBtn.classList.remove('active');
        if (boostInfo) boostInfo.style.display = 'none';
        if (recognition && gameState.isRecognitionActive) {
            try {
                recognition.stop();
                gameState.isRecognitionActive = false;
            } catch(e) {
            }
        }
        if (speechDisplay) speechDisplay.style.display = 'none';

        // Reset close button back to normal
        closeBoostInfo.style.display = '';
        closeBoostInfo.textContent = '✕';
        closeBoostInfo.style = ''; // Reset all styles

        // Reset OK button back to normal
        if (speechOkBtn) {
            speechOkBtn.style.display = '';
            speechOkBtn.textContent = 'OK';
            speechOkBtn.style.background = 'linear-gradient(90deg, #4ecdc4, #44a08d)';
            speechOkBtn.disabled = false;
        }

        showToast('Đã tắt chế độ tăng tỉ lệ', 'info');
    });

    // Touch handling
    setupTouchHandling();
}

// Socket Event Handlers
socket.on('game_started', function(data) {

    // Clear join timeout since game started successfully
    if (joinTimeout) {
        clearTimeout(joinTimeout);
        joinTimeout = null;
    }

    gameState.cards = data.cards;
    gameState.usedCards = data.used_cards || [];
    gameState.mode = data.mode || 3;
    gameState.maxBoosts = data.max_boosts || 3;
    gameState.decks = data.decks || 1;
    gameState.chantCount = data.chant_count || 0;
    gameState.totalSwaps = data.total_swaps || 0;
    gameState.flippedCards = data.flipped_cards || [];
    gameState.folded = data.folded || false;

    // Check if we should show deck suggestion popup
    if (data.show_deck_suggestion && !getDeckSuggestionDisabled()) {
        showDeckSuggestionPopup(data.remaining_cards || 0);
    }

    // Update title based on mode
    const titleElement = document.getElementById('gameTitle');
    if (titleElement) {
        titleElement.textContent = `🎴 BÀI ${gameState.mode || 3} LÁ 🎴`;
    }

    // Add mode class for layout
    if (gameState.mode === 6) {
        cardsContainer.classList.add('mode-6');
    } else {
        cardsContainer.classList.remove('mode-6');
    }

    // Update UI
    // Update UI immediately
        updateCardDisplay();
        updateRoomStats(data);

        // Ensure correct button visibility on game start
        if (newRoundTriggerBtn) newRoundTriggerBtn.style.display = 'none';
        if (foldBtn) foldBtn.style.display = 'flex';

        // Update boost display after a short delay to ensure all gameState is set
        setTimeout(() => {
            updateBoostDisplay();
        }, 100);

        // Set fold button and other controls based on folded state
    if (gameState.folded) {
        // When folded: hide fold button, show new round button
        if (foldBtn) foldBtn.style.display = 'none';
        if (newRoundTriggerBtn) {
            newRoundTriggerBtn.style.display = 'flex';
            // Add class to center the single button
            document.querySelector('.controls').classList.add('single-button');
        }

        // Disable other controls when folded
        swapBtn.disabled = true;
        boostBtn.disabled = true;

        // Disable reveal cards button when folded (as set in fold function)
        const revealCardsBtn = document.getElementById('revealCardsBtn');
        if (revealCardsBtn) revealCardsBtn.disabled = true;

        // Disable card clicking
        const cards = document.querySelectorAll('.card');
        cards.forEach(card => {
            card.style.opacity = '0.5';
            card.style.pointerEvents = 'none';
        });
    } else {
        // When not folded: show fold button, hide new round button
        if (foldBtn) {
            foldBtn.disabled = false;
            foldBtn.textContent = 'Úp bài';
            foldBtn.style.display = 'flex'; // Show fold button
        }
        if (newRoundTriggerBtn) {
            newRoundTriggerBtn.style.display = 'none'; // Hide new round button
        }
        // Remove single button class
        document.querySelector('.controls').classList.remove('single-button');
        // Re-enable other controls
        if (swapBtn) swapBtn.disabled = false;
        if (boostBtn) boostBtn.disabled = false;

        // Ensure reveal cards button is enabled (for viewing only)
        const revealCardsBtn = document.getElementById('revealCardsBtn');
        if (revealCardsBtn) revealCardsBtn.disabled = false;

        // Re-enable card clicking
        const cards = document.querySelectorAll('.card');
        cards.forEach(card => {
            card.style.opacity = '1';
            card.style.pointerEvents = 'auto';
        });
    }

    // Reset round controls
    roundControls.style.display = 'none';
    newRoundBtn.disabled = false;
    newRoundBtn.textContent = '🎯 Sẵn sàng màn mới';

    // Double-check folded state after a short delay to ensure DOM is ready
    setTimeout(() => {
        if (gameState.folded && newRoundTriggerBtn) {
            foldBtn.style.display = 'none';
            newRoundTriggerBtn.style.display = 'flex';
            document.querySelector('.controls').classList.add('single-button');
        }
    }, 200);


    showToast('Trò chơi đã bắt đầu! Chơi độc lập với giao diện riêng.');
});

socket.on('player_joined', function(data) {
    const playerName = data.player_name || 'Người chơi mới';

    // Update game state
    gameState.playersCount = data.total_players || 0;

    // Update all room stats (players, folded, ready counts)
    updateRoomStats(data);

    showToast(`🆕 ${playerName} đã tham gia phòng! Tổng: ${data.total_players} người chơi`, 'info');
});

socket.on('card_swapped', function(data) {
    // Update used cards list
    gameState.usedCards = data.used_cards || [];

    // If this is the player who swapped, update their card
    if (data.player_id === socket.id && data.new_card) {
        gameState.cards[data.card_index] = data.new_card;

        // Show the new card in the completion display
        showNewCardInCompletion(data.new_card);

        // Increase swap count and total swaps
        gameState.swapCount += 1;
        gameState.totalSwaps += 1;

        // Reset chant count after any successful swap (reset tỉ lệ về 1%)
        if (data.reset_chant_count) {
            gameState.chantCount = 0;
        }

        // Update UI (this will handle button enable/disable based on remaining swaps)
        updateBoostDisplay();
    } else if (data.player_id !== socket.id) {
        showToast(`Có người đã sử dụng vị trí ${data.card_index + 1}`);
    }

    // Update display to show disabled cards
    updateCardDisplay();

    // Update boost display after reset
    updateBoostDisplay();
});

socket.on('boost_completed', function(data) {

    // Update used cards list
    gameState.usedCards = data.used_cards || [];

    // If this is the player who boosted, update their card
    if (data.player_id === socket.id && data.new_card) {
        gameState.cards[data.card_index] = data.new_card;

        // Show the new card in the completion display
        showNewCardInCompletion(data.new_card);

        // Show swap completion with close button after animation
        setTimeout(() => {
            showSwapCompletion();
        }, 800); // Wait for card animation to complete

        const boostPercent = data.boost_level === 1 ? 1 : (data.boost_level - 1) * 10;
        // Don't show toast here, will be shown when OK is clicked

        // Increase swap count and total swaps
        gameState.swapCount += 1;
        gameState.totalSwaps += 1;

        // Reset chant count after successful boost (reset tỉ lệ về 1%)
        if (data.reset_chant_count) {
            gameState.chantCount = 0;
        }

        // Update UI
        updateBoostDisplay();
        updateCardDisplay();
    } else if (data.player_id !== socket.id) {
        const boostPercent = data.boost_level === 1 ? 1 : (data.boost_level - 1) * 10;
        showToast(`Có người đã boost thành công với ${boostPercent}% tỉ lệ!`);
    }

    // Update display to show disabled cards
    updateCardDisplay();

    // Update boost count display
    updateBoostDisplay();

    // Update current boost chance
    let currentChance = 1;
    if (gameState.chantCount >= 1) currentChance = 10;
    if (gameState.chantCount >= 2) currentChance = 20;
    if (gameState.chantCount >= 3) currentChance = 30;
    boostChanceDisplay.textContent = `${currentChance}%`;
});

socket.on('player_folded', function(data) {
    gameState.allFolded = data.all_folded;
    updateRoomStats(data);

    if (data.all_folded) {
        // All players folded - just show notification
        showToast('Tất cả đã buông bài! Nhấn "Ván mới" để bắt đầu');
    } else {
        showToast(`${data.folded_count}/${data.total_players} người chơi đã buông bài`);
    }
});

socket.on('all_folded', function(data) {
    gameState.allFolded = true;
    updateRoomStats(data);

    // Show new round trigger button
    if (newRoundTriggerBtn) newRoundTriggerBtn.style.display = 'block';
    showToast(data.message || 'Tất cả đã buông bài! Nhấn "Ván mới" để bắt đầu');
});

socket.on('player_ready', function(data) {
    updateRoomStats(data);

    // Update popup progress if it's visible
    if (newRoundPopup && newRoundPopup.style.display !== 'none') {
        updateNewRoundProgress();
        showToast(`${data.ready_count}/${data.total_players} người chơi sẵn sàng cho ván mới`);
    }
});


socket.on('new_round_started', function(data) {
    showToast('🎯 Ván mới đã bắt đầu! Đang tải lại...', 'success');

    // Reload page after a short delay to ensure smooth transition
    setTimeout(() => {
        window.location.reload();
    }, 1000);
});

socket.on('chant_count_updated', function(data) {
    // Update chant count if it's for another player
    if (data.player_id !== socket.id) {
        // We don't store other players' chant counts locally
        // But we could show it in UI if needed
    }
});

socket.on('card_flipped', function(data) {
    // Update other players' view when someone flips a card
    if (data.player_id !== socket.id) {
        // For now, just update display if needed
        updateCardDisplay();
    }
});

socket.on('swap_failed', function(data) {
    showToast(data.message, 'error');
});

socket.on('card_positions_swapped', function(data) {
    // Update local state if needed (server already handles this)
});

socket.on('error', function(data) {
    showToast(data.message, 'error');
});

// Game Functions
function selectCard(index) {
    if (gameState.isSwapping) return;

    gameState.selectedCardIndex = index;
    swapBtn.disabled = false;
    updateCardDisplay();
    updateSelectedCardDisplay();
    showToast(`Đã chọn lá bài ${index + 1}`);
}

// Update selected card display in swap overlay
function updateSelectedCardDisplay() {
    const selectedCardDisplay = document.getElementById('selectedCardDisplay');
    const selectedCardValue = document.getElementById('selectedCardValue');
    const selectedCardSuit = document.getElementById('selectedCardSuit');

    if (gameState.selectedCardIndex === -1) {
        // No card selected
        if (selectedCardDisplay) selectedCardDisplay.classList.remove('show');
        return;
    }

    const selectedCard = gameState.cards[gameState.selectedCardIndex];
    if (!selectedCard) return;

    // Update card display
    if (selectedCardValue) {
        selectedCardValue.textContent = getCardDisplayValue(selectedCard.value);
    }

    if (selectedCardSuit) {
        selectedCardSuit.textContent = getCardSuit(selectedCard.suit);
    }

    // Add red class for both value and suit for hearts and diamonds
    const isRedSuit = selectedCard.suit === 1 || selectedCard.suit === 2 ||
                     (selectedCard.suit === 5 || selectedCard.suit === 6) ||
                     (selectedCard.suit === 9 || selectedCard.suit === 10);

    if (selectedCardValue) {
        if (isRedSuit) {
            selectedCardValue.classList.add('red');
        } else {
            selectedCardValue.classList.remove('red');
        }
    }

    if (selectedCardSuit) {
        if (isRedSuit) {
            selectedCardSuit.classList.add('red');
        } else {
            selectedCardSuit.classList.remove('red');
        }
    }

    // Show the display with animation
    if (selectedCardDisplay) {
        selectedCardDisplay.classList.add('show');
    }
}

function startSwap() {
    if (gameState.selectedCardIndex === -1) {
        showToast('Vui lòng chọn một lá bài để hoán đổi');
        return;
    }

    // Check current boost level
    let boostLevel = 1; // Default 1%
    if (gameState.chantCount >= 3) {
        boostLevel = 4; // 30%
    } else if (gameState.chantCount >= 2) {
        boostLevel = 3; // 20%
    } else if (gameState.chantCount >= 1) {
        boostLevel = 2; // 10%
    }

    // For level 1 (1%), start energy collection
    if (boostLevel === 1) {
        startActualSwap();
        return;
    }

    // For higher levels, show card selection first
    showCardSelectionOverlay();
}


function performBoostSwap() {

    try {

        // Get selected card value from dropdown
        const cardValueDropdown = document.getElementById('cardValueDropdown');

        if (!cardValueDropdown) {
            console.error('cardValueDropdown not found!');
            return;
        }

        const selectedValue = parseInt(cardValueDropdown.value);

        if (!selectedValue) {
            showToast('Vui lòng chọn giá trị lá bài!', 'warning');
            return;
        }

        gameState.desiredValue = selectedValue;

        // Hide card selection overlay
        hideCardSelectionOverlay();

    } catch (error) {
        console.error('Error in performBoostSwap:', error);
        showToast('Lỗi: ' + error.message, 'error');
        return;
    }

    // Continue with the rest of the function

    // Calculate boost percentage based on chant count
    const boostPercent = gameState.chantCount >= 3 ? 30 : gameState.chantCount >= 2 ? 20 : gameState.chantCount >= 1 ? 10 : 1;

    // Delay slightly to ensure overlay is properly hidden before showing energy collection
    setTimeout(() => {
        showEnergyCollectionOverlay(boostPercent);
    }, 200);
}

function performRegularSwap() {
    if (gameState.selectedCardIndex === -1) return;

    // Khóa thanh năng lượng và touch points ngay lập tức
    disableSwapInteractions();

    // Use the boost percentage that was set during energy collection
    const boostPercent = gameState.currentBoostPercent || 1;

    // Show boost info in toast
    if (boostPercent > 1) {
        showToast(`🔄 Hoán bài với tỉ lệ ${boostPercent}% (từ ${gameState.chantCount} lần niệm chú)...`, 'info');
    } else {
        showToast(`🔄 Hoán bài ngẫu nhiên (${boostPercent}%)...`, 'info');
    }

    // Emit swap_card
    socket.emit('swap_card', {
        room_id: gameState.roomId,
        card_index: gameState.selectedCardIndex
    });

    // Show swap completion instead of immediately hiding overlay
    showSwapCompletion();

    // Reset selection and desired value
    gameState.selectedCardIndex = -1;
    gameState.desiredValue = null;
    swapBtn.disabled = true;
    updateCardDisplay();
    updateSelectedCardDisplay();
}

// Show energy collection overlay for all boost levels using existing swapOverlay
function showEnergyCollectionOverlay(boostPercent) {

    // Use existing swapOverlay instead of creating new overlay
    const overlay = document.getElementById('swapOverlay');
    if (!overlay) {
        console.error('swapOverlay not found!');
        return;
    }

    // Setup for boost mode (same as regular swap)
    gameState.isSwapping = true;
    gameState.energy = 0;
    gameState.currentBoostPercent = boostPercent;

    // Reset energy display
    updateEnergyDisplay();
    updateSpeedDisplay();
    updateFingerCount();

    // Update energy bar for boost
    const overlayEnergyFill = document.getElementById('overlayEnergyFill');
    if (overlayEnergyFill) {
        overlayEnergyFill.style.width = '0%';
    }

    // Show overlay (energy collection will start via touch events)
    overlay.classList.add('active');
}

// Start collecting energy from shake detection
function startShakeEnergyCollection() {

    // Clear any existing interval
    if (gameState.energyDecreaseInterval) {
        clearInterval(gameState.energyDecreaseInterval);
    }

    // Reset energy and shake count
    gameState.energy = 0;
    gameState.shakeCount = 0;
    updateEnergyDisplay();

    // Start energy decrease over time
    gameState.energyDecreaseInterval = setInterval(() => {
        if (gameState.energy > 0) {
            gameState.energy = Math.max(0, gameState.energy - gameState.energyDecreaseRate);
            updateEnergyDisplay();
        }
    }, 100);

    // Enable shake detection for energy
    gameState.shakeMode = true;
}

// Update energy display
function updateEnergyDisplay() {
    const energyFill = document.getElementById('energyFill');
    const energyPercent = document.getElementById('energyPercent');

    if (energyFill && energyPercent) {
        const percentage = Math.min(100, (gameState.energy / gameState.requiredEnergyForSwap) * 100);
        energyFill.style.width = `${percentage}%`;
        energyPercent.textContent = `${Math.round(percentage)}%`;

        // If energy is full, complete the boost
        if (percentage >= 100) {
            completeEnergyBoost();
        }
    }
}

// Complete energy boost and perform swap
function completeEnergyBoost() {

    // Clear energy collection
    stopEnergyCollection();

    // Keep swapOverlay active for showing swap result
    // Don't hide it here - let performRegularSwap handle it

    // Reset swapping state but keep overlay active
    gameState.isSwapping = false;

    // Perform the actual swap
    performRegularSwap();
}

// Stop energy collection
function stopEnergyCollection() {
    // Clear interval
    if (gameState.energyDecreaseInterval) {
        clearInterval(gameState.energyDecreaseInterval);
        gameState.energyDecreaseInterval = null;
    }

    // Disable shake mode
    gameState.shakeMode = false;
    gameState.shakeCount = 0;
}

// Show swap completion with new card and OK button
function showSwapCompletion() {
    // Don't hide overlay immediately, show completion state instead
    // The overlay will be hidden when user clicks OK button

    const overlay = document.getElementById('swapOverlay');
    if (!overlay) {
        console.error('swapOverlay not found for completion!');
        return;
    }

    // Instead of replacing HTML, just show the completion elements
    // The overlay should already have the card display from energy collection
    const swapCompleted = document.getElementById('swapCompleted');
    if (swapCompleted) {
        swapCompleted.style.display = 'block';
        swapCompleted.classList.add('show');
        swapCompleted.style.pointerEvents = 'auto';
    }

    // Update OK button text
    const okBtn = document.getElementById('swapOkBtn');
    if (okBtn) {
        okBtn.textContent = 'ĐÓNG';
        okBtn.style.pointerEvents = 'auto';
    }

    // Add event listener for OK button
    if (okBtn) {

        // Remove any existing event listeners to avoid duplicates
        okBtn.removeEventListener('click', handleSwapOk);
        okBtn.addEventListener('click', handleSwapOk);
    }

}

// Disable touch interactions and energy bar after swap starts
function disableSwapInteractions() {
    // Dừng tất cả intervals ngay lập tức
    if (gameState.energyDecreaseInterval) {
        clearInterval(gameState.energyDecreaseInterval);
        gameState.energyDecreaseInterval = null;
    }
    if (gameState.speedUpdateInterval) {
        clearInterval(gameState.speedUpdateInterval);
        gameState.speedUpdateInterval = null;
    }

    const overlayEnergy = document.querySelector('.overlay-energy');
    const touchPoints = document.querySelector('.touch-points');
    const selectedCardDisplay = document.getElementById('selectedCardDisplay');
    const swapOverlay = document.getElementById('swapOverlay');

    // Disable toàn bộ overlay trừ selected card display
    if (swapOverlay) {
        swapOverlay.style.pointerEvents = 'none';
    }

    // Disable energy bar visually và functionally
    if (overlayEnergy) {
        overlayEnergy.classList.add('disabled');
        overlayEnergy.style.pointerEvents = 'none';
    }

    // Disable touch points visually và functionally
    if (touchPoints) {
        touchPoints.classList.add('disabled');
        touchPoints.style.pointerEvents = 'none';
    }

    // Keep selected card display interactive for OK button (sẽ được enable sau)
    if (selectedCardDisplay) {
        selectedCardDisplay.style.pointerEvents = 'auto';
    }

    // Đặt trạng thái để ngăn chặn mọi tương tác khác
    gameState.isSwapping = false;
    gameState.energy = 0;

}

// Show new card in completion display with simultaneous fade animation
function showNewCardInCompletion(newCard) {
    const selectedCardLarge = document.getElementById('selectedCardLarge');
    const selectedCardValue = document.getElementById('selectedCardValue');
    const selectedCardSuit = document.getElementById('selectedCardSuit');

    if (!selectedCardLarge || !selectedCardValue || !selectedCardSuit || !newCard) return;

    // Start simultaneous fade out and prepare for fade in
    selectedCardLarge.classList.add('fade-out-simultaneous');

    // Immediately update card content (while still visible)
    setTimeout(() => {
        // Update to show the NEW card
        selectedCardValue.textContent = getCardDisplayValue(newCard.value);
        selectedCardSuit.textContent = getCardSuit(newCard.suit);

        // Add red class for both value and suit for hearts and diamonds
        const isRedSuit = newCard.suit === 1 || newCard.suit === 2 ||
                         (newCard.suit === 5 || newCard.suit === 6) ||
                         (newCard.suit === 9 || newCard.suit === 10);

        if (isRedSuit) {
            selectedCardValue.classList.add('red');
            selectedCardSuit.classList.add('red');
        } else {
            selectedCardValue.classList.remove('red');
            selectedCardSuit.classList.remove('red');
        }

        // Switch to fade in (card will go from 50% opacity to 100%)
        selectedCardLarge.classList.remove('fade-out-simultaneous');
        selectedCardLarge.classList.add('fade-in-simultaneous');

    }, 400); // Update content at 50% of animation (when old card is 50% faded)
}

// Handle OK button click - hide overlay like clicking X
function handleSwapOk() {
    hideSwapOverlay();
    showToast('Đã hoàn thành hoán bài!', 'success');
}

function hideSwapOverlay() {
    document.getElementById('swapOverlay').classList.remove('active');

    // Hide selected card display and swap completion
    const selectedCardDisplay = document.getElementById('selectedCardDisplay');
    if (selectedCardDisplay) {
        selectedCardDisplay.classList.remove('show');
    }

    const swapCompleted = document.getElementById('swapCompleted');
    if (swapCompleted) {
        swapCompleted.classList.remove('show');
        swapCompleted.style.display = 'none';
    }

    // Re-enable interactions và reset visual effects
    const swapOverlay = document.getElementById('swapOverlay');
    const overlayEnergy = document.querySelector('.overlay-energy');
    const touchPoints = document.querySelector('.touch-points');

    if (swapOverlay) {
        swapOverlay.style.pointerEvents = 'auto';
    }

    if (overlayEnergy) {
        overlayEnergy.classList.remove('disabled');
        overlayEnergy.style.pointerEvents = 'auto';
    }

    if (touchPoints) {
        touchPoints.classList.remove('disabled');
        touchPoints.style.pointerEvents = 'auto';
    }

    // Clear intervals
    if (gameState.energyDecreaseInterval) {
        clearInterval(gameState.energyDecreaseInterval);
        gameState.energyDecreaseInterval = null;
    }
    if (gameState.speedUpdateInterval) {
        clearInterval(gameState.speedUpdateInterval);
        gameState.speedUpdateInterval = null;
    }

    // Reset swap state
    gameState.isSwapping = false;
    gameState.energy = 0;
    gameState.averageSpeed = 0;
    gameState.fingersTouching = 0;
    updateEnergyDisplay();
    updateSpeedDisplay();
    updateFingerCount();

}

function showCardSelectionOverlay() {
    const overlay = document.getElementById('cardSelectionOverlay');
    const cardValueDropdown = document.getElementById('cardValueDropdown');
    const confirmBtn = document.getElementById('confirmCardSelection');

    // Reset dropdown
    cardValueDropdown.value = '';

    // Disable options that are not available (all 4 suits are used)
    let hasAvailableOptions = false;
    for (let value = 1; value <= 13; value++) {
        const option = cardValueDropdown.querySelector(`option[value="${value}"]`);
        if (option) {
            // Check if all 4 suits of this value are used
            const allSuitsUsed = [0, 1, 2, 3].every(suit => {
                const cardIndex = (value - 1) + (suit * 13);
                return gameState.usedCards.includes(cardIndex);
            });

            option.disabled = allSuitsUsed;
            if (allSuitsUsed) {
                option.textContent = `${getCardDisplayValue(value)} (hết)`;
            } else {
                option.textContent = getCardDisplayValue(value);
                hasAvailableOptions = true;
            }
        }
    }

    // If no options available, show message and disable confirm button
    if (!hasAvailableOptions) {
        showToast('Không còn lá bài nào để chọn!', 'error');
        overlay.classList.remove('active');
        return;
    }

    // Disable confirm button initially
    confirmBtn.disabled = true;

    // Show overlay
    overlay.classList.add('active');
}

function hideCardSelectionOverlay() {
    const overlay = document.getElementById('cardSelectionOverlay');
    if (overlay) {
        overlay.classList.remove('active');
    } else {
        console.error('Card selection overlay element not found');
    }
}

function flipCard(cardIndex, finalRotation) {
    // Add to flipped cards
    if (!gameState.flippedCards.includes(cardIndex)) {
        gameState.flippedCards.push(cardIndex);

        // Send to server to save flipped state
        socket.emit('flip_card', {
            room_id: gameState.roomId,
            card_index: cardIndex,
            rotation: finalRotation
        });
    }

    // Remove card back image
    const cardElement = document.querySelector(`[data-card-index="${cardIndex}"]`);
    if (cardElement) {
        // Remove card back
        const cardBack = cardElement.querySelector('.card-back');
        if (cardBack) {
            cardBack.remove();
        }

        // Add click handler for selection (card is now revealed)
        cardElement.addEventListener('click', () => selectCard(cardIndex));
    }
}

function revealAllCards() {

    // Find all cards that are not yet flipped
    const unflippedCardIndexes = [];
    gameState.cards.forEach((card, index) => {
        const isFlipped = gameState.flippedCards.includes(index);
        if (!isFlipped) {
            unflippedCardIndexes.push(index);
        }
    });


    if (unflippedCardIndexes.length === 0) {
        showToast('Tất cả lá bài đã được mở!', 'info');
        return;
    }

    // Reveal all unflipped cards
    unflippedCardIndexes.forEach(cardIndex => {
        flipCard(cardIndex, 0);
    });

    showToast(`Đã mở ${unflippedCardIndexes.length} lá bài!`, 'success');
}

function updateRoomStats(data) {
    if (totalPlayersDisplay && data.total_players !== undefined) {
        totalPlayersDisplay.textContent = data.total_players;
    }
    if (foldedCountDisplay && data.folded_count !== undefined) {
        foldedCountDisplay.textContent = data.folded_count;
    }
    if (readyCountDisplay && data.ready_count !== undefined) {
        readyCountDisplay.textContent = data.ready_count;
    }
}

function showNewRoundPopup() {
    // Send ready signal
    socket.emit('ready_for_new_round', {
        room_id: gameState.roomId
    });

    gameState.readyForNewRound = true;

    // Show popup
    newRoundPopup.style.display = 'block';

    // Update progress
    updateNewRoundProgress();

    showToast('Đã sẵn sàng cho ván mới!', 'success');
}

function hideNewRoundPopup() {
    newRoundPopup.style.display = 'none';
}

function updateNewRoundProgress() {
    const readyCount = parseInt(readyCountDisplay.textContent) || 0;
    const totalPlayers = parseInt(totalPlayersDisplay.textContent) || 1;

    // Update progress bar
    const percentage = (readyCount / totalPlayers) * 100;
    if (readyProgressFill) {
        readyProgressFill.style.width = `${percentage}%`;
    }

    // Update progress text
    if (readyProgressText) {
        readyProgressText.textContent = `${readyCount}/${totalPlayers} người chơi đã sẵn sàng`;
    }

    // Update status list (this would need player data from server)
    // For now, just show basic info
}

function initShakeDetection() {
    if (window.DeviceMotionEvent) {
        window.addEventListener('devicemotion', handleDeviceMotion);
    } else {
        // Always use rub mode
    }
}

function handleDeviceMotion(event) {
    if (!gameState.isSwapping) return;

    const acceleration = event.accelerationIncludingGravity;
    if (!acceleration) return;

    const { x, y, z } = acceleration;
    const { lastAcceleration } = gameState;

    // Calculate movement delta
    const deltaX = Math.abs(x - lastAcceleration.x);
    const deltaY = Math.abs(y - lastAcceleration.y);
    const deltaZ = Math.abs(z - lastAcceleration.z);

    // Update last acceleration
    gameState.lastAcceleration = { x, y, z };

    // Check if shake detected
    if (deltaX > gameState.shakeThreshold ||
        deltaY > gameState.shakeThreshold ||
        deltaZ > gameState.shakeThreshold) {

        gameState.shakeCount++;

        // Add energy based on shake intensity (only in shake mode)
        if (gameState.shakeMode) {
            const shakeIntensity = Math.max(deltaX, deltaY, deltaZ);
            const energyGain = Math.min(shakeIntensity * 2, 10); // Max 10 energy per shake
            gameState.energy += energyGain;
            updateEnergyDisplay();
        }

        gameState.energy = Math.min(gameState.energy + energyGain, gameState.requiredEnergyForSwap);

        updateEnergyDisplay();

        // Visual feedback
        const swapOverlay = document.getElementById('swapOverlay');
        if (swapOverlay) {
            swapOverlay.style.background = `rgba(102, 126, 234, ${Math.min(gameState.energy / gameState.requiredEnergyForSwap, 0.3)})`;
            setTimeout(() => {
                swapOverlay.style.background = '';
            }, 100);
        }

        // Check if energy full
        if (gameState.energy >= gameState.requiredEnergyForSwap) {
            completeSwap();
        }
    }
}

function startActualSwap() {
    gameState.isSwapping = true;
    gameState.energy = 0;
    gameState.averageSpeed = 0;
    gameState.fingersTouching = 0;
    updateEnergyDisplay();
    updateSpeedDisplay();
    updateFingerCount();

    // Show overlay
    document.getElementById('swapOverlay').classList.add('active');

    // Setup based on swap mode - Always use rub mode for now
    if (false) { // Disabled shake mode, use rub mode
        // Shake mode: disable touch tracking, enable shake detection
        gameState.fingersTouching = 0;
        gameState.shakeCount = 0;
        updateFingerCount();
        updateSpeedDisplay();

        // Show shake instruction
        const instructionElement = document.querySelector('.swap-instruction');
        if (instructionElement) {
            instructionElement.textContent = 'Lắc điện thoại để tích năng lượng!';
        }
    } else {
        // Rub mode: enable touch tracking
        // Reset touch points display
        for (let i = 1; i <= 4; i++) {
            document.getElementById(`touch${i}`).classList.remove('active');
        }

        // Show rub instruction
        const instructionElement = document.querySelector('.swap-instruction');
        if (instructionElement) {
            instructionElement.textContent = 'Chà màn hình để tích năng lượng!';
        }

        // Start speed update interval
        if (!gameState.speedUpdateInterval) {
            gameState.speedUpdateInterval = setInterval(updateAverageSpeed, 500);
        }
    }

    // Start energy decrease interval (for both modes)
    if (!gameState.energyDecreaseInterval) {
        gameState.energyDecreaseInterval = setInterval(decreaseEnergy, 100);
    }
}

function fold() {
    if (gameState.folded) {
        showToast('Bạn đã buông bài rồi!', 'warning');
        return;
    }

    // Reveal all unflipped cards before folding
    revealAllCards();

    socket.emit('fold', {
        room_id: gameState.roomId
    });

    gameState.folded = true;
    showToast('Bạn đã buông bài!', 'info');

    // Hide fold button and show new round button
    foldBtn.style.display = 'none';
    if (newRoundTriggerBtn) newRoundTriggerBtn.style.display = 'flex';

    // Also disable reveal cards button
    if (revealCardsBtn) revealCardsBtn.disabled = true;

    // Cancel any ongoing swap if player is swapping
    if (gameState.isSwapping) {
        hideSwapOverlay();
        gameState.isSwapping = false;
        gameState.energy = 0;
        updateEnergyDisplay();
        clearInterval(gameState.energyDecreaseInterval);
        clearInterval(gameState.speedUpdateInterval);
        showToast('Đã hủy hoán bài do buông bài', 'warning');
    }

    // Disable other controls when folded
    swapBtn.disabled = true;
    boostBtn.disabled = true;

    // Disable card clicking (add visual indicator)
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
    });

    showToast('Đã buông bài! Chờ người chơi khác...');
}

function readyForNewRound() {
    if (gameState.readyForNewRound) {
        showToast('Bạn đã sẵn sàng rồi!', 'warning');
        return;
    }

    socket.emit('ready_for_new_round', {
        room_id: gameState.roomId
    });

    gameState.readyForNewRound = true;
    if (newRoundBtn) {
        newRoundBtn.disabled = true;
        newRoundBtn.textContent = '✅ Đã sẵn sàng';
    }
    showToast('Đã sẵn sàng cho màn mới!');
}

function startBoost() {
    // Check if already boosting
    if (gameState.isBoosting) {
        showToast('Đang trong chế độ tăng tỉ lệ!');
        return;
    }

    // Không có giới hạn số lượt tăng tỉ lệ - có thể tăng vô thời hạn

    gameState.isBoosting = true;
    // Don't reset chantCount here - keep current progress

    // Show boost info as popup overlay
    if (boostInfo) boostInfo.style.display = 'flex';
    boostBtn.classList.add('active');

        // Show speech display immediately
        if (speechDisplay) {
            speechDisplay.style.display = 'block';
            speechText.style.background = 'rgba(0, 0, 0, 0.5)';
            speechText.style.borderColor = 'rgba(78, 205, 196, 0.3)';
            speechText.style.fontWeight = 'normal';
            speechText.textContent = capitalizeFirst('hãy nói câu thần chú');
            // Start waiting dots animation immediately
            animateWaitingDots();
        }

    showToast('🔮 Tăng tỉ lệ: Nói thần chú để tăng tỉ lệ cho lần hoán bài tiếp theo');
    updateBoostDisplay();
    startSpeechRecognition();
}

function showValueSelectionOverlay() {
    // Create or show value selection overlay
    let overlay = document.getElementById('valueSelectionOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'valueSelectionOverlay';
        overlay.className = 'overlay';
        overlay.innerHTML = `
            <button class="cancel-btn" id="cancelValueSelection">✕</button>
            <h2 class="overlay-title">CHỌN LÁ BÀI BOOST</h2>
            <p class="overlay-instruction">Chọn giá trị lá bài bạn muốn:</p>
            <div class="value-selection-grid">
                <button class="value-btn" data-value="1">A</button>
                <button class="value-btn" data-value="2">2</button>
                <button class="value-btn" data-value="3">3</button>
                <button class="value-btn" data-value="4">4</button>
                <button class="value-btn" data-value="5">5</button>
                <button class="value-btn" data-value="6">6</button>
                <button class="value-btn" data-value="7">7</button>
                <button class="value-btn" data-value="8">8</button>
                <button class="value-btn" data-value="9">9</button>
                <button class="value-btn" data-value="10">10</button>
                <button class="value-btn" data-value="11">J</button>
                <button class="value-btn" data-value="12">Q</button>
                <button class="value-btn" data-value="13">K</button>
            </div>
        `;
        document.body.appendChild(overlay);

        // Add event listeners
        overlay.querySelectorAll('.value-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                selectDesiredValue(parseInt(this.dataset.value));
            });
        });

        document.getElementById('cancelValueSelection').addEventListener('click', function() {
            overlay.classList.remove('active');
            gameState.isBoosting = false;
            boostBtn.classList.remove('active');
            boostInfo.style.display = 'none';
        });
    }

    overlay.classList.add('active');
}

function selectDesiredValue(value) {
    gameState.desiredValue = value;

    // Hide value selection overlay
    document.getElementById('valueSelectionOverlay').classList.remove('active');

    // Keep boosting active for speech recognition
    // gameState.isBoosting = false; // Don't disable boost mode
    // boostBtn.classList.remove('active'); // Keep button active
    // boostInfo.style.display = 'none'; // Keep info visible

    // Keep speech display visible for recognition
    if (speechDisplay) {
        speechDisplay.style.display = 'block';
        speechText.style.background = 'rgba(0, 0, 0, 0.5)';
        speechText.style.borderColor = 'rgba(78, 205, 196, 0.3)';
        speechText.style.fontWeight = 'normal';
        speechText.textContent = capitalizeFirst('hãy nói câu thần chú');
        // Start waiting dots animation immediately
        animateWaitingDots();
    }

    const boostPercent = gameState.chantCount >= 3 ? 30 : gameState.chantCount >= 2 ? 20 : gameState.chantCount >= 1 ? 10 : 1;
    showToast(`Tỉ lệ đã được tăng lên ${boostPercent}%!`);

    // Start speech recognition for chanting
    startSpeechRecognition();
}

function completeBoost(boostLevel) {
    // Boost is now just increasing chant count, not performing actual swap
    // The actual boost happens during regular swap

    // Reset boost state but keep chant count
    gameState.isBoosting = false;
    boostBtn.classList.remove('active');
    boostInfo.style.display = 'none';

    showToast(`Tỉ lệ đã được tăng lên ${(boostLevel - 1) * 10 || 1}%!`);
}

function resetGame() {
    // Reset game state
    gameState.selectedCardIndex = -1;
    gameState.energy = 0;
    gameState.isSwapping = false;
    updateEnergyDisplay();
    swapBtn.disabled = true;
    showToast('Đã reset ván chơi');
}

// Update card display
function updateCardDisplay() {
    cardsContainer.innerHTML = '';

    gameState.cards.forEach((card, index) => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card';
        cardElement.setAttribute('data-card-index', index);

        // Check if this card index is used by someone else (owned by another player)
        // Note: We don't disable the player's own cards, only check for ownership conflicts during swap
        if (index === gameState.selectedCardIndex) {
            cardElement.classList.add('selected');
        }

        // Check if card is flipped (revealed)
        const isFlipped = gameState.flippedCards && gameState.flippedCards.includes(index);

        if (isFlipped) {
            // Show actual card value and suit
            const valueElement = document.createElement('div');
            valueElement.className = 'card-value';
            valueElement.textContent = getCardDisplayValue(card.value);

            const suitElement = document.createElement('div');
            suitElement.className = 'card-suit';
            suitElement.textContent = getCardSuit(card.suit);

            // Cơ (♥) và rô (♦) có màu đỏ cho cả value và suit
            // Deck 2 có màu xanh cho tất cả 4 chất nhưng vẫn có 4 chất và 2 màu giống deck 1
            // Deck 3 có màu đen cho tất cả 4 chất nhưng vẫn có 4 chất và 2 màu giống deck 1
            if (card.suit === 1 || card.suit === 2) {
                valueElement.style.color = '#dc3545';
                suitElement.classList.add('red');
            } else if (card.deck === 2) {
                // For deck 2, use same color scheme as deck 1 (red/black) but with blue tint
                // Hearts (♥) and Diamonds (♦) are red, Spades (♠) and Clubs (♣) are black
                if (card.suit === 5 || card.suit === 6) { // Hearts and Diamonds in deck 2 (suit 4+1, 4+2)
                    valueElement.style.color = '#dc3545';
                    suitElement.classList.add('red');
                } else { // Spades and Clubs in deck 2 (suit 4+0, 4+3)
                    // Keep default black color
                }
            } else if (card.deck === 3) {
                // For deck 3, use same color scheme as deck 1 (red/black) but with dark tint
                // Hearts (♥) and Diamonds (♦) are red, Spades (♠) and Clubs (♣) are black
                if (card.suit === 9 || card.suit === 10) { // Hearts and Diamonds in deck 3 (suit 8+1, 8+2)
                    valueElement.style.color = '#dc3545';
                    suitElement.classList.add('red');
                } else { // Spades and Clubs in deck 3 (suit 8+0, 8+3)
                    // Keep default black color
                }
            }

            cardElement.appendChild(valueElement);
            cardElement.appendChild(suitElement);

            // Add click event for selection
            cardElement.addEventListener('click', () => selectCard(index));
        } else {
            // Always show the actual card underneath
            const valueElement = document.createElement('div');
            valueElement.className = 'card-value';
            valueElement.textContent = getCardDisplayValue(card.value);

            const suitElement = document.createElement('div');
            suitElement.className = 'card-suit';
            suitElement.textContent = getCardSuit(card.suit);

            // Cơ (♥) và rô (♦) có màu đỏ cho cả value và suit
            // Deck 2 có màu xanh cho tất cả 4 chất nhưng vẫn có 4 chất và 2 màu giống deck 1
            // Deck 3 có màu đen cho tất cả 4 chất nhưng vẫn có 4 chất và 2 màu giống deck 1
            if (card.suit === 1 || card.suit === 2) {
                valueElement.style.color = '#dc3545';
                suitElement.classList.add('red');
            } else if (card.deck === 2) {
                // For deck 2, use same color scheme as deck 1 (red/black) but with blue tint
                // Hearts (♥) and Diamonds (♦) are red, Spades (♠) and Clubs (♣) are black
                if (card.suit === 5 || card.suit === 6) { // Hearts and Diamonds in deck 2 (suit 4+1, 4+2)
                    valueElement.style.color = '#dc3545';
                    suitElement.classList.add('red');
                } else { // Spades and Clubs in deck 2 (suit 4+0, 4+3)
                    // Keep default black color
                }
            } else if (card.deck === 3) {
                // For deck 3, use same color scheme as deck 1 (red/black) but with dark tint
                // Hearts (♥) and Diamonds (♦) are red, Spades (♠) and Clubs (♣) are black
                if (card.suit === 9 || card.suit === 10) { // Hearts and Diamonds in deck 3 (suit 8+1, 8+2)
                    valueElement.style.color = '#dc3545';
                    suitElement.classList.add('red');
                } else { // Spades and Clubs in deck 3 (suit 8+0, 8+3)
                    // Keep default black color
                }
            }

            cardElement.appendChild(valueElement);
            cardElement.appendChild(suitElement);

            // Add card back image on top with swipe functionality
            const backImage = document.createElement('img');
            backImage.className = 'card-back';
            backImage.src = card.deck === 1 ? '/static/img/red.jpg' : card.deck === 2 ? '/static/img/blue.jpg' : '/static/img/black.jpg';
            backImage.alt = `Card Back - Deck ${card.deck}`;
            backImage.draggable = false;
            backImage.style.width = '100%';
            backImage.style.height = '100%';
            backImage.style.objectFit = 'cover';
            backImage.style.borderRadius = '12px';
            backImage.style.position = 'absolute';
            backImage.style.top = '0';
            backImage.style.left = '0';
            backImage.style.pointerEvents = 'auto'; // Allow mouse events on card back
            backImage.style.zIndex = '10'; // Ensure it appears above other elements

            // Fallback if image doesn't load
            backImage.onerror = function() {
                this.style.display = 'none';
                const fallback = document.createElement('div');
                fallback.textContent = `DECK ${card.deck}`;
                fallback.style.fontSize = '24px';
                fallback.style.fontWeight = 'bold';
                fallback.style.color = card.deck === 1 ? '#ff6b6b' : '#4ecdc4';
                fallback.style.display = 'flex';
                fallback.style.alignItems = 'center';
                fallback.style.justifyContent = 'center';
                fallback.style.width = '100%';
                fallback.style.height = '100%';
                fallback.style.position = 'absolute';
                fallback.style.top = '0';
                fallback.style.left = '0';
                this.parentNode.appendChild(fallback);
            };

            cardElement.style.position = 'relative';
            cardElement.style.overflow = 'visible'; // Allow card back to extend outside
            cardElement.style.transformStyle = 'preserve-3d'; // Better 3D transforms
            cardElement.appendChild(backImage);

            // Add swipe functionality to the card back image
            let startX, startY, startTime;
            let isDragging = false;
            let hasTriggeredFlip = false;

            backImage.addEventListener('mousedown', (e) => {
                if (hasTriggeredFlip) return; // Prevent multiple triggers

                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                startTime = Date.now();
                backImage.style.cursor = 'grabbing';
                cardElement.style.userSelect = 'none';
                e.preventDefault(); // Prevent default drag behavior
            });

            backImage.addEventListener('mousemove', (e) => {
                if (!isDragging || hasTriggeredFlip) return;

                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                // Check if pulled far enough to trigger immediate flip
                if (distance > 150) { // Threshold for immediate flip
                    hasTriggeredFlip = true;
                    flipCard(index, 0); // Immediately flip the card
                    return;
                }

                // Translate the card back away from center (no rotation, no scale, no opacity)
                backImage.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
                backImage.style.transformOrigin = 'center center';
            });

            backImage.addEventListener('mouseup', (e) => {
                if (!isDragging) return;

                const endTime = Date.now();
                const duration = endTime - startTime;
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                isDragging = false;
                backImage.style.cursor = 'grab';
                cardElement.style.userSelect = '';

                // If already flipped during mousemove, do nothing
                if (hasTriggeredFlip) return;

                // Check if swipe is valid (distance > 120px and duration < 1000ms)
                if (distance > 120 && duration < 1000) {
                    hasTriggeredFlip = true;
                    flipCard(index, 0); // Immediately flip the card
                } else {
                    // Reset - return to original position
                    backImage.style.transition = 'transform 0.3s ease';
                    backImage.style.transform = 'translate(0px, 0px)';

                    // Remove transition after reset
                    setTimeout(() => {
                        backImage.style.transition = 'transform 0.3s ease';
                    }, 300);
                }
            });

            // Touch event listeners for mobile support
            let touchStartX, touchStartY, touchStartTime;
            let isTouchDragging = false;

            backImage.addEventListener('touchstart', (e) => {
                if (hasTriggeredFlip) return;

                isTouchDragging = true;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchStartTime = Date.now();
                backImage.style.cursor = 'grabbing';
                cardElement.style.userSelect = 'none';
                e.preventDefault();
            });

            backImage.addEventListener('touchmove', (e) => {
                if (!isTouchDragging || hasTriggeredFlip) return;

                const touchX = e.touches[0].clientX;
                const touchY = e.touches[0].clientY;
                const deltaX = touchX - touchStartX;
                const deltaY = touchY - touchStartY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                // Check if pulled far enough to trigger immediate flip
                if (distance > 150) {
                    hasTriggeredFlip = true;
                    flipCard(index, 0);
                    return;
                }

                backImage.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
                backImage.style.transformOrigin = 'center center';
                e.preventDefault();
            });

            backImage.addEventListener('touchend', (e) => {
                if (!isTouchDragging) return;

                const endTime = Date.now();
                const duration = endTime - touchStartTime;
                const touchX = e.changedTouches[0].clientX;
                const touchY = e.changedTouches[0].clientY;
                const deltaX = touchX - touchStartX;
                const deltaY = touchY - touchStartY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                isTouchDragging = false;
                backImage.style.cursor = 'grab';
                cardElement.style.userSelect = '';

                if (hasTriggeredFlip) return;

                if (distance > 120 && duration < 1000) {
                    hasTriggeredFlip = true;
                    flipCard(index, 0);
                } else {
                    backImage.style.transition = 'transform 0.3s ease';
                    backImage.style.transform = 'translate(0px, 0px)';

                    setTimeout(() => {
                        backImage.style.transition = 'transform 0.3s ease';
                    }, 300);
                }
            });
        }

        cardsContainer.appendChild(cardElement);
    });

    // Re-initialize drag & drop for new cards
    setTimeout(() => {
        initCardDragDrop();
    }, 100);

    // Update swap count
}

// Get display value for card
function getCardDisplayValue(value) {
    switch(value % 13 + 1) {
        case 1: return 'A';
        case 11: return 'J';
        case 12: return 'Q';
        case 13: return 'K';
        default: return value % 13 + 1;
    }
}

// Get card suit
function getCardSuit(suit) {
    const suits = ['♠', '♥', '♦', '♣'];
    // Handle both deck 1 (suit 0-3) and deck 2 (suit 4-7)
    const normalizedSuit = suit % 4;
    return suits[normalizedSuit];
}

// Convert card value and suit to deck index (0-51)
function cardToIndex(value, suit) {
    return (value - 1) + (suit * 13);
}

// Convert deck index to card value and suit
function indexToCard(index) {
    const value = (index % 13) + 1;
    const suit = Math.floor(index / 13);
    return { value, suit };
}

// Check if a card (value, suit) is available (not used by any player)
function isCardAvailable(value, suit) {
    const cardIndex = cardToIndex(value, suit);
    return !gameState.usedCards.includes(cardIndex);
}


// Update energy display
function updateEnergyDisplay() {
    const percent = Math.round(gameState.energy);
    energyFill.style.width = `${percent}%`;
    energyPercent.textContent = `${percent}%`;
    overlayEnergyFill.style.width = `${percent}%`;
    // overlayEnergyPercent.textContent = `${percent}%`; // Commented out - overlay removed

    // Change color when full or decreasing
    if (percent >= 100) {
        energyFill.classList.add('full');
        energyFill.classList.remove('decreasing');
        overlayEnergyFill.classList.add('full');
        overlayEnergyFill.classList.remove('decreasing');
    } else if (gameState.isSwapping && gameState.averageSpeed < 20) {
        energyFill.classList.add('decreasing');
        overlayEnergyFill.classList.add('decreasing');
    } else {
        energyFill.classList.remove('full');
        energyFill.classList.remove('decreasing');
        overlayEnergyFill.classList.remove('full');
        overlayEnergyFill.classList.remove('decreasing');
    }
}

// Update speed display
function updateSpeedDisplay() {
    const speed = Math.round(gameState.averageSpeed);
    speedDisplay.textContent = speed;
    // overlaySpeedDisplay.textContent = speed; // Commented out - overlay removed
}

// Update finger count display
function updateFingerCount() {
    fingerCount.textContent = `Ngón tay: ${gameState.fingersTouching}/${gameState.minFingersRequired}`;
    // overlayFingerCount.textContent = `Ngón tay: ${gameState.fingersTouching}/${gameState.minFingersRequired}`; // Commented out - overlay removed
}

// Update boost display
function updateBoostDisplay() {

    // Update current boost chance
    let currentChance = 1;
    if (gameState.chantCount >= 1) currentChance = 10;
    if (gameState.chantCount >= 2) currentChance = 20;
    if (gameState.chantCount >= 3) currentChance = 30;
    boostChanceDisplay.textContent = `${currentChance}%`;

    // Update remaining swaps for current round
    const remainingSwaps = Math.max(0, gameState.maxBoosts - gameState.totalSwaps);
    swapsRemainingDisplay.textContent = remainingSwaps;

    // Add visual warning when low on swaps
    if (remainingSwaps <= 1) {
        swapsRemainingDisplay.style.color = '#ff6b6b';
        if (remainingSwaps === 0) {
            swapsRemainingDisplay.style.fontWeight = 'bold';
        }
    } else {
        swapsRemainingDisplay.style.color = '#4ecdc4';
        swapsRemainingDisplay.style.fontWeight = 'normal';
    }

    // Show warning when only 1 swap left
    if (remainingSwaps === 1) {
        showToast('⚠️ Chỉ còn 1 lượt hoán bài!', 'warning');
    }

    // Update chant bubbles based on chantCount
    for (let i = 1; i <= 3; i++) {
        const chantBubble = document.getElementById(`chant${i}`);
        if (chantBubble) {
            if (i <= gameState.chantCount) {
                // Filled bubble for completed chants
                chantBubble.classList.add('filled');
                chantBubble.classList.remove('active');
                chantBubble.style.background = 'linear-gradient(135deg, #4ecdc4, #44a08d)';
                chantBubble.style.color = 'white';
                chantBubble.style.transform = 'scale(1.1)';
            } else if (i === gameState.chantCount + 1) {
                // Active bubble for next chant
                chantBubble.classList.add('active');
                chantBubble.classList.remove('filled');
                // Remove inline styles to use CSS class styles
                chantBubble.style.background = '';
                chantBubble.style.color = '';
                chantBubble.style.transform = 'scale(1)';
            } else {
                // Empty bubble
                chantBubble.classList.remove('filled', 'active');
                chantBubble.style.background = 'rgba(255, 255, 255, 0.2)';
                chantBubble.style.color = 'rgba(255, 255, 255, 0.7)';
                chantBubble.style.transform = 'scale(1)';
            }
        }
    }

    // Disable swap and boost buttons when no swaps remaining

    // Force disable buttons if no swaps remaining, regardless of folded state
    if (remainingSwaps === 0) {
        if (swapBtn) {
            swapBtn.disabled = true;
            swapBtn.style.opacity = '0.5';
        }
        if (boostBtn) {
            boostBtn.disabled = true;
            boostBtn.style.opacity = '0.5';
        }

        // Only show toast once to avoid spam
        if (!gameState.swapLimitReached) {
            showToast('🚫 Đã hết lượt hoán bài trong round này!', 'error');
            gameState.swapLimitReached = true;
        }
    } else {
        if (swapBtn) {
            swapBtn.disabled = gameState.folded;
            swapBtn.style.opacity = gameState.folded ? '0.5' : '1';
        }
        if (boostBtn) {
            boostBtn.disabled = gameState.folded;
            boostBtn.style.opacity = gameState.folded ? '0.5' : '1';
        }
        gameState.swapLimitReached = false;
    }

    // Update chant bubbles
    chantBubbles.forEach((bubble, index) => {
        if (index < gameState.chantCount) {
            bubble.classList.add('active');
        } else {
            bubble.classList.remove('active');
        }
    });

    // Update chant instruction
    chantInstruction.style.display = 'block';
    document.querySelector('.chant-display').style.display = 'flex';

        if (gameState.chantCount === 0) {
            chantInstruction.textContent = 'Nói "nam mô a di đà phật" xong bấm OK → tỉ lệ hoán bài lên 10%';
        } else if (gameState.chantCount === 1) {
            chantInstruction.textContent = 'Nói tiếp "nam mô a di đà phật" xong bấm OK → tỉ lệ lên 20%';
        } else if (gameState.chantCount === 2) {
            chantInstruction.textContent = 'Nói lần cuối "nam mô a di đà phật" xong bấm OK → tỉ lệ 30%';
        } else {
            chantInstruction.textContent = '🎯 Đã đạt tỉ lệ tối đa 30%! Có thể nói thêm để duy trì tỉ lệ cao';
        }
}

// Check HTTPS requirement for microphone access
function checkMicrophoneHTTPSRequirement() {
    const isHTTPS = location.protocol === 'https:';

    // Always require HTTPS for microphone access (browsers requirement)
    if (!isHTTPS) {
        console.warn('HTTPS required for microphone access');
        showToast('⚠️ Cần HTTPS để sử dụng microphone. Vui lòng truy cập qua HTTPS URL.', 'warning');
        return false;
    }

    return true;
}

// Request microphone permission
function requestMicrophonePermission() {
    return new Promise((resolve, reject) => {
        // Check HTTPS requirement first
        if (!checkMicrophoneHTTPSRequirement()) {
            reject(new Error('HTTPS required for production'));
            return;
        }

        // Check if browser supports getUserMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn('getUserMedia not supported');
            showToast('Trình duyệt không hỗ trợ truy cập microphone', 'error');
            reject(new Error('getUserMedia not supported'));
            return;
        }

        // Check current permission state if supported
        if (navigator.permissions) {
            navigator.permissions.query({ name: 'microphone' }).then((permissionStatus) => {

                if (permissionStatus.state === 'granted') {
                    // Already granted, resolve immediately
                    resolve();
                } else if (permissionStatus.state === 'denied') {
                    // Denied, show message and reject
                    showToast('Microphone bị từ chối. Vui lòng cấp quyền trong cài đặt trình duyệt!', 'error');
                    reject(new Error('Permission denied'));
                } else {
                    // Prompt or unknown, request permission
                    requestMicAccess(resolve, reject);
                }
            }).catch(() => {
                // Permissions API not fully supported, try direct request
                requestMicAccess(resolve, reject);
            });
        } else {
            // Permissions API not supported, try direct request
            requestMicAccess(resolve, reject);
        }
    });
}

// Helper function to request microphone access
function requestMicAccess(resolve, reject) {
    navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    })
    .then((stream) => {
        // Permission granted, stop the stream immediately
        stream.getTracks().forEach(track => track.stop());
        showToast('Microphone đã được cấp quyền! 🎤', 'success');
        resolve();
    })
    .catch((error) => {
        console.error('Microphone permission error:', error);

        if (error.name === 'NotAllowedError') {
            showToast('Vui lòng cấp quyền microphone để sử dụng tính năng thần chú! 🔒', 'warning');
        } else if (error.name === 'NotFoundError') {
            showToast('Không tìm thấy microphone trên thiết bị này!', 'error');
        } else {
            showToast('Lỗi khi truy cập microphone: ' + error.message, 'error');
        }

        reject(error);
    });
}

// Clear all speech transcript data to prevent auto-processing

// Initialize speech recognition
function initSpeechRecognition() {
    // Check HTTPS requirement
    if (!checkMicrophoneHTTPSRequirement()) {
        return;
    }

    if (!SpeechRecognition) {
        console.warn('Speech Recognition API not supported');
        showToast('Trình duyệt không hỗ trợ nhận diện giọng nói');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false; // Đơn giản: không continuous
    recognition.interimResults = true; // Bật interim results để capture tốt hơn
    recognition.lang = 'vi-VN';

    recognition.onstart = function() {
        gameState.isRecognitionActive = true;
        // Clear previous transcript when starting new recognition
        gameState.currentTranscript = '';
        // Stop waiting dots when actively listening
        stopWaitingDots();
        // Show that we're listening
        if (speechText) {
            speechText.textContent = '🎤 Đang lắng nghe...';
        }
    };

    recognition.onresult = function(event) {
        // Lấy kết quả cuối cùng (final result)
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalTranscript = event.results[i][0].transcript;
                break;
            }
        }

        // Nếu có final result, sử dụng nó
        if (finalTranscript.trim()) {
            gameState.currentTranscript = finalTranscript.toLowerCase();

            // Hiển thị full transcript final
            if (speechText) {
                speechText.textContent = `🎤 ${finalTranscript}`;
            }
        } else {
            // Interim result - hiển thị tạm thời với "..."
            const interimTranscript = event.results[event.results.length - 1][0].transcript;
            if (speechText && interimTranscript.trim()) {
                speechText.textContent = `🎤 ${interimTranscript}...`;
            }
        }
    };

    recognition.onerror = function(event) {
        gameState.isRecognitionActive = false;
        gameState.isRecognitionStopping = false;
        if (event.error === 'not-allowed') {
            showToast('Cần cấp quyền microphone!', 'error');
        } else if (event.error === 'not-found') {
            showToast('Không tìm thấy microphone!', 'error');
        }
        // Không xử lý aborted errors - để user bấm OK lại
    };

    recognition.onend = function() {
        console.log('Speech recognition ended');
        gameState.isRecognitionActive = false;
        gameState.isRecognitionStopping = false;
        // Không auto-restart waiting dots - chỉ lắng nghe thôi
        // Dots sẽ được restart sau khi bấm OK và reset UI
    };
}

// Cleanup speech recognition
function cleanupSpeechRecognition() {
    if (recognition) {
        try {
            recognition.stop();
        } catch(e) {
            // Ignore errors during cleanup
        }
        recognition = null;
        gameState.isRecognitionActive = false;
    }
}

// Start speech recognition
function startSpeechRecognition() {
    if (!checkMicrophoneHTTPSRequirement()) return;

    if (!recognition) {
        initSpeechRecognition();
    }

    if (!recognition) {
        showToast('Không thể khởi tạo nhận diện giọng nói', 'error');
        return;
    }

    if (gameState.isRecognitionActive || gameState.isRecognitionStopping) {
        console.warn('Speech recognition already active or stopping, skipping start');
        return;
    }

    try {
        console.log('Starting speech recognition...');
        recognition.start();
        console.log('Speech recognition started successfully');
    } catch(e) {
        console.error('Error starting speech recognition:', e);
        if (e.name === 'InvalidStateError') {
            showToast('Microphone đang bận, vui lòng thử lại', 'warning');
        } else {
            showToast('Lỗi microphone: ' + e.message, 'error');
        }
    }
}

// Process speech result - đơn giản
function processSpeechResult(transcript) {

    // Disable button
    speechOkBtn.disabled = true;
    speechOkBtn.textContent = '🔄 Xử lý...';

    // Check if correct chant with precise word-by-word comparison
    const isCorrect = normalizeAndCompareChant(transcript);

    if (isCorrect) {
        // Correct - show success message with boost percentage
        const boostPercent = gameState.chantCount >= 2 ? 30 : gameState.chantCount >= 1 ? 20 : 10;

        speechText.style.background = 'rgba(40, 167, 69, 0.3)';
        speechText.style.borderColor = '#28a745';
        speechText.style.fontWeight = 'bold';
        speechText.textContent = `${capitalizeFirst('bạn đã nói đúng câu thần chú!')} Chúc mừng bạn có thêm ${boostPercent}% tỉ lệ hoán bài!\n\n${capitalizeFirst('hãy nói câu thần chú')}`;

        // Boost is now applied during normal swap - no need to emit boost_swap here

        // Tăng chant count (KHÔNG thực hiện swap ngay)
        gameState.chantCount++;
        updateBoostDisplay();

        // Update chant count in database
        socket.emit('update_chant_count', {
            room_id: gameState.roomId,
            chant_count: gameState.chantCount
        });

        // Nếu đạt max level, kết thúc boost mode
        if (gameState.chantCount >= 3) {
            setTimeout(() => {
                endBoostMode();
            }, 3000);
            return; // Don't reset UI for max level
        }
    } else {
        // Wrong - show error with what user said
        speechText.style.background = 'rgba(220, 53, 69, 0.3)';
        speechText.style.borderColor = '#dc3545';
        speechText.style.fontWeight = 'bold';
        // Hiển thị đơn giản: bạn nói sai + câu user nói
        speechText.textContent = `${capitalizeFirst('bạn nói sai')}, "${transcript}"\n\n${capitalizeFirst('hãy nói câu thần chú')}`;
    }

    // Reset button after 2 seconds but keep the result text
        setTimeout(() => {
        speechOkBtn.disabled = false;
        speechOkBtn.textContent = 'OK';
        speechOkBtn.style.background = 'linear-gradient(90deg, #4ecdc4, #44a08d)';

        // Clear transcript for next round
        gameState.currentTranscript = '';

        // Start listening again
        if (gameState.isBoosting && !gameState.isRecognitionActive) {
            startSpeechRecognition();
            // Start waiting dots animation
            animateWaitingDots();
        }
    }, 2000);
}

// Helper function to capitalize first letter
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Check if a user word matches the target word (with variations)
function checkWordMatch(userWord, targetWord) {
    const variations = {
        'nam': ['nam', 'năm'],
        'mô': ['mô', 'mo', 'mồ', 'mố'],
        'a': ['a', 'à'],
        'di': ['di', 'dì', 'đi', 'đì'],
        'đà': ['đà', 'da', 'đa', 'dà'],
        'phật': ['phật', 'phat', 'phất']
    };

    const targetVariations = variations[targetWord] || [targetWord];
    return targetVariations.some(variation =>
        userWord.includes(variation) || variation.includes(userWord)
    );
}

// Normalize and compare chant with flexible word matching
function normalizeAndCompareChant(userTranscript) {
    // Target chant words with variations
    const targetWords = [
        ['nam', 'năm'],           // nam/năm
        ['mô', 'mo', 'mồ', 'mố'], // mô/mo/mồ/mố
        ['a', 'à'],               // a/à
        ['di', 'dì', 'đi', 'đì'], // di/dì/đi/đì
        ['đà', 'da', 'đa', 'dà'], // đà/da/đa/dà
        ['phật', 'phat', 'phất']  // phật/phat/phất
    ];

    // Normalize user transcript
    const userWords = userTranscript.toLowerCase()
        .replace(/[.,!?;:""''()]/g, '') // Remove punctuation
        .split(/\s+/) // Split by whitespace
        .filter(word => word.length > 0); // Remove empty strings


    // Must have at least the target number of words
    if (userWords.length < targetWords.length) {
        return false;
    }

    // Check each target word against corresponding user word
    for (let i = 0; i < targetWords.length; i++) {
        const targetVariations = targetWords[i];
        const userWord = userWords[i];

        if (!userWord) {
            return false;
        }

        // Check if user word matches any variation of target word
        const matches = targetVariations.some(variation =>
            userWord.includes(variation) || variation.includes(userWord)
        );

        if (!matches) {
            return false;
        }

    }

    return true;
}

// Animate dots for waiting effect
function animateWaitingDots() {
    // Clear any existing animation
    if (window.waitingDotsInterval) {
        clearInterval(window.waitingDotsInterval);
    }

    let dots = 0;

    // Start immediately with first dot
    const updateDots = () => {
        // Only animate when in boost mode and not actively recognizing
        if (!gameState.isBoosting || gameState.isRecognitionActive) {
        return;
    }

        // Cycle through 0, 1, 2, 3 dots
        dots = (dots + 1) % 4;
        const dotsText = '.'.repeat(dots);

        // Update text with animated dots immediately
        if (speechText && (speechText.textContent.includes('Hãy nói câu thần chú') || speechText.textContent.includes('hãy nói câu thần chú'))) {
            const baseText = speechText.textContent.replace(/\.*$/, ''); // Remove existing dots
            speechText.textContent = `${baseText}${dotsText}`;
        }
    };

    // Start immediately
    updateDots();

    // Then continue with interval
    window.waitingDotsInterval = setInterval(updateDots, 300);
}

// Stop waiting dots animation
function stopWaitingDots() {
    if (window.waitingDotsInterval) {
        clearInterval(window.waitingDotsInterval);
        window.waitingDotsInterval = null;
    }
}

// End boost mode completely
function endBoostMode() {
    gameState.isBoosting = false;
    boostBtn.classList.remove('active');
    boostInfo.style.display = 'none';

    // Stop speech recognition
    if (recognition && gameState.isRecognitionActive) {
        recognition.stop();
    }

    // Hide speech display
    if (speechDisplay) {
        speechDisplay.style.display = 'none';
    }

    showToast('🎉 Đã đạt tỉ lệ tối đa 30%! Có thể tiếp tục hoán bài.');
}

// Play chant sound
function playChantSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.2);

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch(e) {
    }
}

// Touch event handling
function setupTouchHandling() {
    const swapOverlay = document.getElementById('swapOverlay');
    const cancelOverlay = document.getElementById('cancelOverlay');

    // Touch start
    swapOverlay.addEventListener('touchstart', function(e) {
        if (!gameState.isSwapping) return;

        e.preventDefault();

        gameState.fingersTouching = e.touches.length;
        updateFingerCount();

        for (let i = 0; i < e.touches.length && i < 4; i++) {
            const touch = e.touches[i];
            const id = touch.identifier;

            gameState.lastX[id] = touch.clientX;
            gameState.lastY[id] = touch.clientY;
            gameState.lastMoveTime[id] = Date.now();
            gameState.moveSpeeds[id] = 0;

            if (i < 4) {
                document.getElementById(`touch${i+1}`).classList.add('active');
            }
        }
    }, { passive: false });

    // Touch move
    swapOverlay.addEventListener('touchmove', function(e) {
        if (!gameState.isSwapping || gameState.energy >= 100) return;

        e.preventDefault();

        const now = Date.now();
        let totalEnergyGain = 0;
        let totalSpeed = 0;
        let activeFingers = 0;

        gameState.fingersTouching = e.touches.length;
        updateFingerCount();

        for (let i = 0; i < e.touches.length && i < 4; i++) {
            const touch = e.touches[i];
            const id = touch.identifier;

            if (gameState.lastX[id] !== undefined) {
                const dx = touch.clientX - gameState.lastX[id];
                const dy = touch.clientY - gameState.lastY[id];
                const distance = Math.sqrt(dx * dx + dy * dy);
                const timeDiff = now - gameState.lastMoveTime[id];

                if (timeDiff > 0) {
                    const speed = distance / (timeDiff / 1000);
                    gameState.moveSpeeds[id] = speed;

                    if (distance > gameState.touchThreshold) {
                        const speedFactor = Math.min(speed / 200, 2);
                        const fingerFactor = Math.min(gameState.fingersTouching / 4, 1);

                        const energyGain = gameState.baseEnergyPerMove * speedFactor * fingerFactor;

                        totalEnergyGain += energyGain;
                        totalSpeed += speed;
                        activeFingers++;

                        gameState.lastX[id] = touch.clientX;
                        gameState.lastY[id] = touch.clientY;
                        gameState.lastMoveTime[id] = now;
                    }
                }
            }
        }

        if (totalEnergyGain > 0 && activeFingers >= 2) {
            gameState.energy = Math.min(100, gameState.energy + totalEnergyGain);
            updateEnergyDisplay();

            if (activeFingers > 0) {
                gameState.averageSpeed = totalSpeed / activeFingers;
                updateSpeedDisplay();
            }

            // If energy is full, perform swap
            if (gameState.energy >= 100) {
                setTimeout(() => {
                    performRegularSwap();
                }, 300);
            }
        }
    }, { passive: false });

    // Touch end
    swapOverlay.addEventListener('touchend', function(e) {
        if (!gameState.isSwapping) return;

        gameState.fingersTouching = e.touches.length;
        updateFingerCount();

        const endedTouches = e.changedTouches;
        for (let i = 0; i < endedTouches.length; i++) {
            const id = endedTouches[i].identifier;
            delete gameState.lastX[id];
            delete gameState.lastY[id];
            delete gameState.lastMoveTime[id];
            delete gameState.moveSpeeds[id];
        }

        const activeTouches = e.touches.length;
        for (let i = 1; i <= 4; i++) {
            const touchPoint = document.getElementById(`touch${i}`);
            if (i > activeTouches) {
                touchPoint.classList.remove('active');
            } else {
                touchPoint.classList.add('active');
            }
        }
    }, { passive: false });

    // Cancel overlay
    cancelOverlay.addEventListener('click', function() {
        document.getElementById('swapOverlay').classList.remove('active');
        gameState.isSwapping = false;
        gameState.energy = 0;
        updateEnergyDisplay();
        showToast('Đã hủy hoán bài');
    });

    // Prevent touch events on cancel button from triggering overlay touch handlers
    cancelOverlay.addEventListener('touchstart', function(e) {
        e.stopPropagation();
    });

    cancelOverlay.addEventListener('touchmove', function(e) {
        e.stopPropagation();
    });

    cancelOverlay.addEventListener('touchend', function(e) {
        e.stopPropagation();
        // Trigger click for touch devices
        cancelOverlay.click();
    });
}

// Perform the actual swap
function performSwapWithDesiredCard() {
    if (gameState.selectedCardIndex === -1 || !gameState.desiredCard) return;

    // Send swap request to server
    socket.emit('swap_card', {
        room_id: gameState.roomId,
        card_index: gameState.selectedCardIndex,
        desired_card: gameState.desiredCard,
        chant_count: gameState.chantCount
    });

    // Hide overlay and cleanup
    hideSwapOverlay();
}

// Decrease energy when not rubbing
function decreaseEnergy() {
    if (!gameState.isSwapping) return;

    const now = Date.now();
    let allFingersIdle = true;

    Object.keys(gameState.lastMoveTime).forEach(id => {
        if (now - gameState.lastMoveTime[id] < 500) {
            allFingersIdle = false;
        }
    });

    if (allFingersIdle && gameState.energy > 0) {
        gameState.energy = Math.max(0, gameState.energy - (gameState.energyDecreaseRate / 10));
        updateEnergyDisplay();
        energyFill.classList.add('decreasing');
        overlayEnergyFill.classList.add('decreasing');
    }
}

// Update average speed
function updateAverageSpeed() {
    if (!gameState.isSwapping) return;

    const speeds = Object.values(gameState.moveSpeeds);
    if (speeds.length > 0) {
        const sum = speeds.reduce((a, b) => a + b, 0);
        gameState.averageSpeed = sum / speeds.length;
    } else {
        gameState.averageSpeed = 0;
    }

    updateSpeedDisplay();
}


// Show toast message
function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}


// Confirm speech text - simple: stop -> process -> reset
function confirmSpeechText() {
    if (!speechText) return;

    // Dừng recognition
    if (recognition && gameState.isRecognitionActive && !gameState.isRecognitionStopping) {
        try {
            gameState.isRecognitionStopping = true;
            recognition.stop();
        } catch(e) {
            console.warn('Error stopping recognition:', e);
            gameState.isRecognitionStopping = false;
        }
    }

    // Lấy transcript từ gameState (đã được lưu trong onresult)
    const transcript = gameState.currentTranscript || '';

    if (transcript.trim()) {
        // Có transcript - process
        processSpeechResult(transcript.trim());
        } else {
        // Không có transcript - chỉ reset để tiếp tục lắng nghe

        // Reset về trạng thái chờ và bắt đầu lắng nghe sau một khoảng delay
        speechText.style.background = 'rgba(0, 0, 0, 0.5)';
        speechText.style.borderColor = 'rgba(78, 205, 196, 0.3)';
            speechText.style.fontWeight = 'normal';
        speechText.textContent = capitalizeFirst('hãy nói câu thần chú');
        animateWaitingDots();

                speechOkBtn.disabled = false;
                speechOkBtn.textContent = 'OK';
                speechOkBtn.style.background = 'linear-gradient(90deg, #4ecdc4, #44a08d)';

        // Thêm delay nhỏ để đảm bảo recognition đã stop hoàn toàn trước khi start lại
        setTimeout(() => {
            if (gameState.isBoosting && !gameState.isRecognitionActive) {
                startSpeechRecognition();
            }
        }, 100);
    }
}


// Drag & Drop Functions
function initCardDragDrop() {
    const cards = document.querySelectorAll('.card');

    cards.forEach((card, index) => {
        // Only allow dragging for revealed cards
        if (!gameState.flippedCards.includes(index)) return;

        // Mouse events
        card.addEventListener('mousedown', (e) => startCardDrag(e, card, index));
        card.addEventListener('mouseenter', (e) => handleCardHover(e, card, index));

        // Touch events for mobile
        card.addEventListener('touchstart', (e) => startCardDrag(e, card, index), { passive: false });
    });

    // Global mouse/touch events
    document.addEventListener('mousemove', handleCardDrag);
    document.addEventListener('touchmove', handleCardDrag, { passive: false });
    document.addEventListener('mouseup', endCardDrag);
    document.addEventListener('touchend', endCardDrag);
}

function startCardDrag(e, card, index) {
    if (gameState.isSwapping || gameState.isDragging) return;

    e.preventDefault();

    // Set potential drag state
    gameState.isPotentialDrag = true;
    gameState.dragStartTime = Date.now();
    gameState.potentialDragCard = card;
    gameState.potentialDragIndex = index;

    // Calculate offset for potential dragging
    const rect = card.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    gameState.dragOffset = {
        x: clientX - rect.left,
        y: clientY - rect.top
    };

    // Start drag after 300ms delay if still holding
    gameState.dragTimeout = setTimeout(() => {
        if (gameState.isPotentialDrag) {
            startActualDrag(card, index);
        }
    }, 300);

}

function startActualDrag(card, index) {
    gameState.isDragging = true;
    gameState.draggedCard = card;
    gameState.draggedCardIndex = index;

    // Add dragging class
    card.classList.add('dragging');

    // Create ghost card
    createGhostCard(card, index);

    // Show drag feedback
    showDragFeedback();

}

function handleCardDrag(e) {
    if (!gameState.isPotentialDrag) return;

    e.preventDefault();

    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    // Check if this is a significant move (drag vs click)
    const startX = gameState.dragOffset.x;
    const startY = gameState.dragOffset.y;
    const rect = gameState.potentialDragCard.getBoundingClientRect();
    const moveDistance = Math.sqrt(
        Math.pow(clientX - (rect.left + startX), 2) +
        Math.pow(clientY - (rect.top + startY), 2)
    );

    // If moved more than 10px, start actual drag
    if (moveDistance > 10 && !gameState.isDragging) {
        clearTimeout(gameState.dragTimeout);
        startActualDrag(gameState.potentialDragCard, gameState.potentialDragIndex);
    }

    // If actual drag has started, move the card
    if (gameState.isDragging && gameState.draggedCard) {
        // Move dragged card
        gameState.draggedCard.style.position = 'fixed';
        gameState.draggedCard.style.left = (clientX - gameState.dragOffset.x) + 'px';
        gameState.draggedCard.style.top = (clientY - gameState.dragOffset.y) + 'px';
        gameState.draggedCard.style.zIndex = '1000';

        // Find drop target
        const dropTarget = findDropTarget(clientX, clientY);
        updateDropTargets(dropTarget);
    }
}

function endCardDrag(e) {
    // Clear drag timeout
    if (gameState.dragTimeout) {
        clearTimeout(gameState.dragTimeout);
        gameState.dragTimeout = null;
    }

    if (gameState.isDragging) {
        // Handle actual drag end
        const clientX = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
        const clientY = e.clientY || (e.changedTouches && e.changedTouches[0].clientY);

        // Find final drop target
        const dropTarget = findDropTarget(clientX, clientY);

        if (dropTarget && dropTarget !== gameState.draggedCard) {
            // Swap cards
            swapCards(gameState.draggedCardIndex, dropTarget.dataset.cardIndex);
        } else {
            // Return to original position
            resetDraggedCard();
        }

        // Cleanup
        cleanupDragState();
    } else if (gameState.isPotentialDrag) {
        // Handle quick click (select card)
        const elapsedTime = Date.now() - gameState.dragStartTime;
        if (elapsedTime < 300) {
            // This was a quick click, select the card
            selectCard(gameState.potentialDragIndex);
        }

        // Reset potential drag state
        gameState.isPotentialDrag = false;
        gameState.potentialDragCard = null;
        gameState.potentialDragIndex = -1;
    }
}

function findDropTarget(clientX, clientY) {
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
        if (card === gameState.draggedCard || !card.classList.contains('card')) continue;

        const rect = card.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right &&
            clientY >= rect.top && clientY <= rect.bottom) {
            return card;
        }
    }
    return null;
}

function updateDropTargets(dropTarget) {
    const cards = document.querySelectorAll('.card');

    cards.forEach(card => {
        card.classList.remove('drop-target', 'drag-over');
    });

    if (dropTarget) {
        dropTarget.classList.add('drop-target');
    }
}

function createGhostCard(originalCard, index) {
    const ghostCard = originalCard.cloneNode(true);
    ghostCard.classList.add('ghost-card');
    ghostCard.style.position = 'absolute';
    ghostCard.style.left = originalCard.offsetLeft + 'px';
    ghostCard.style.top = originalCard.offsetTop + 'px';
    ghostCard.style.zIndex = '1';

    originalCard.parentNode.appendChild(ghostCard);
    gameState.ghostCard = ghostCard;
}

function swapCards(fromIndex, toIndex) {
    const fromIdx = parseInt(fromIndex);
    const toIdx = parseInt(toIndex);

    if (fromIdx === toIdx) return;


    // Swap in game state
    [gameState.cards[fromIdx], gameState.cards[toIdx]] =
    [gameState.cards[toIdx], gameState.cards[fromIdx]];

    // Swap flipped states
    const fromFlippedIndex = gameState.flippedCards.indexOf(fromIdx);
    const toFlippedIndex = gameState.flippedCards.indexOf(toIdx);

    if (fromFlippedIndex !== -1) gameState.flippedCards[fromFlippedIndex] = toIdx;
    if (toFlippedIndex !== -1) gameState.flippedCards[toFlippedIndex] = fromIdx;

    // Update display
    updateCardDisplay();

    // Send to server
    socket.emit('swap_card_positions', {
        room_id: gameState.roomId,
        from_index: fromIdx,
        to_index: toIdx
    });

    showToast('Đã đổi vị trí lá bài!', 'success');
}

function resetDraggedCard() {
    if (gameState.draggedCard) {
        gameState.draggedCard.style.position = '';
        gameState.draggedCard.style.left = '';
        gameState.draggedCard.style.top = '';
        gameState.draggedCard.style.zIndex = '';
    }
}

function cleanupDragState() {
    gameState.isDragging = false;
    gameState.isPotentialDrag = false;

    if (gameState.draggedCard) {
        gameState.draggedCard.classList.remove('dragging');
        resetDraggedCard();
    }

    if (gameState.ghostCard) {
        gameState.ghostCard.remove();
        gameState.ghostCard = null;
    }

    gameState.draggedCard = null;
    gameState.draggedCardIndex = -1;
    gameState.potentialDragCard = null;
    gameState.potentialDragIndex = -1;

    // Clear drag timeout
    if (gameState.dragTimeout) {
        clearTimeout(gameState.dragTimeout);
        gameState.dragTimeout = null;
    }

    // Clear all drop target highlights
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.classList.remove('drop-target', 'drag-over');
    });

    // Hide drag feedback
    hideDragFeedback();
}

function showDragFeedback() {
    const feedback = document.getElementById('dragFeedback');
    if (feedback) {
        feedback.classList.remove('hidden');
    }
}

function hideDragFeedback() {
    const feedback = document.getElementById('dragFeedback');
    if (feedback) {
        feedback.classList.add('hidden');
    }
}

function handleCardHover(e, card, index) {
    // Only show hover effects during actual drag (not potential drag)
    if (gameState.isDragging && gameState.draggedCard !== card) {
        card.classList.add('drag-over');

        // Remove hover from other cards
        const cards = document.querySelectorAll('.card');
        cards.forEach(otherCard => {
            if (otherCard !== card && otherCard !== gameState.draggedCard) {
                otherCard.classList.remove('drag-over');
            }
        });
    }
}

// Auto-hide toast when clicked
toast.addEventListener('click', function() {
    this.classList.remove('show');
});

// Deck suggestion popup functions
function showDeckSuggestionPopup(remainingCards) {
    if (remainingCardsCount) {
        remainingCardsCount.textContent = remainingCards;
    }
    if (deckSuggestionPopup) {
        deckSuggestionPopup.style.display = 'flex';
    }
}

function hideDeckSuggestionPopup() {
    if (deckSuggestionPopup) {
        deckSuggestionPopup.style.display = 'none';
    }
}

function dontShowDeckSuggestionAgain() {
    // Save setting to localStorage to not show again
    localStorage.setItem('deckSuggestionDisabled', 'true');
    hideDeckSuggestionPopup();
    showToast('Đã tắt thông báo đề xuất bộ bài', 'info');
}

function getDeckSuggestionDisabled() {
    return localStorage.getItem('deckSuggestionDisabled') === 'true';
}
