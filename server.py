from flask import Flask, render_template, request, redirect, url_for
from flask_socketio import SocketIO, join_room, leave_room, emit
import random
import string
import json
import sqlite3
import socket
from database import db
import schedule
import time
import threading

def get_local_ip():
    """Get the local IP address of this machine"""
    try:
        # Create a socket to get local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # Connect to Google DNS
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception as e:
        print(f"Could not get local IP: {e}")
        return "localhost"

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'

# Add CORS headers for all routes
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# Use threading for both production and development (more compatible with Fly.io)
import os
if os.environ.get('FLY_APP_NAME') or os.environ.get('VERCEL'):
    # Production on Fly.io or Vercel - use threading with polling only (more stable)
    socketio = SocketIO(
        app,
        cors_allowed_origins="*",
        async_mode='threading',
        logger=False,
        engineio_logger=False,
        ping_timeout=60,  # Reduced from 120 to 60 for faster error detection
        ping_interval=25,   # Slightly reduced for more responsive pings
        transports=['polling'],  # Use polling only for better stability with threading
        max_http_buffer_size=1e6,  # 1MB buffer
        allow_upgrades=False,  # Disable websocket upgrade to avoid 400 errors
        cookie=None,  # Disable cookies for better compatibility
        always_connect=False,  # Changed to False to reduce connection pressure
        reconnection=True,
        reconnection_attempts=10,  # Increased attempts for better reliability
        reconnection_delay=2,  # Increased from 1 to 2 for less aggressive reconnections
        reconnection_delay_max=30  # Increased from 5 to 30 for more stable reconnections
    )
else:
    # Development - use threading
    socketio = SocketIO(
        app,
        cors_allowed_origins="*",
        async_mode='threading',
        logger=True,
        engineio_logger=True
    )

def generate_room_id():
    """Generate a unique 6-character room ID"""
    while True:
        room_id = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not db.get_room_info(room_id):
            return room_id

def generate_cards(num_cards, used_cards, decks=1):
    """Generate random cards for a player, avoiding used cards"""
    cards = []
    total_cards = 52 * decks  # 52 cards per deck
    available_indices = [i for i in range(total_cards) if i not in used_cards]

    if len(available_indices) < num_cards:
        # If not enough cards available, reset used cards (this shouldn't happen in normal play)
        available_indices = list(range(total_cards))

    selected_indices = random.sample(available_indices, num_cards)

    for card_index in selected_indices:
        value = (card_index % 13) + 1
        suit = card_index // 13
        deck = card_index // 52 + 1  # Deck number (1 or 2)
        cards.append({'value': value, 'suit': suit, 'index': card_index, 'deck': deck})

    return cards

@app.route('/')
def lobby():
    """Lobby page for creating/joining rooms"""
    return render_template('lobby.html')

@app.route('/<room_id>')
def join_via_url(room_id):
    """Join room directly via URL - always show game page"""
    room_id = room_id.upper()
    room_info = db.get_room_info(room_id)
    if room_info:
        return render_template('game.html', room_id=room_id)
    else:
        return redirect(url_for('lobby'))

@app.route('/<room_id>/systemcall/<command>')
def system_call(room_id, command):
    """Handle system calls for special game commands"""
    room_id = room_id.upper()
    room_info = db.get_room_info(room_id)
    if not room_info:
        return redirect(url_for('join_via_url', room_id=room_id))

    command = command.lower()

    if command == 'openall':
        # Force fold all players and flip all their cards immediately
        current_round = db.get_current_round_number(room_id)
        for player_id in room_info['players']:
            # Fold player
            db.fold_player(player_id, True, room_id, current_round)

            # Flip all cards for this player
            player_data = room_info['players'][player_id]
            flipped_cards = list(range(len(player_data['cards'])))  # Flip all cards (indices 0, 1, 2, ...)

            # Update flipped cards in database
            db.update_player_flipped_cards(player_id, flipped_cards, room_id, current_round)

            # Emit card flip events for each card
            for card_index in range(len(player_data['cards'])):
                socketio.emit('card_flipped', {
                    'player_id': player_id,
                    'card_index': card_index,
                    'rotation': 180  # Full flip
                }, room=room_id)

        # Update room info after all players are folded
        room_info_updated = db.get_room_info(room_id)
        room_stats = get_room_stats(room_info_updated)

        # Emit folded status for all players (like they folded themselves)
        socketio.emit('all_players_folded_silently', {
            'message': 'System: Tất cả người chơi đã buông bài',
            **room_stats
        }, room=room_id)

        # Redirect back to game page
        return redirect(url_for('join_via_url', room_id=room_id))

    elif command == 'newround':
        # Set all players as ready for new round
        current_round = db.get_current_round_number(room_id)
        for player_id in room_info['players']:
            db.ready_player_for_new_round(player_id, True, room_id, current_round)

        # Check if all players are ready and start new round
        room_info_updated = db.get_room_info(room_id)
        all_ready = all(player_data['ready_for_new_round'] for player_data in room_info_updated['players'].values())

        if all_ready:
            print(f"System call: All players ready in room {room_id}, starting new round...")
            start_new_round_logic(room_id)

        # Redirect back to game page
        return redirect(url_for('join_via_url', room_id=room_id))

    else:
        # Handle card swap commands (format: card1-card2)
        if '-' not in command:
            return redirect(url_for('join_via_url', room_id=room_id))

        card1_str, card2_str = command.split('-', 1)

        # Parse card values
        card1_value = parse_card_value(card1_str)
        card2_value = parse_card_value(card2_str)

        if card1_value is None or card2_value is None:
            return redirect(url_for('join_via_url', room_id=room_id))

        # LOGIC MỚI: Xử lý systemcall/thamso1-thamso2
        # Bước 1: Tìm người chơi nào gọi systemcall này
        if not room_info['players']:
            return redirect(url_for('join_via_url', room_id=room_id))

        # Trong implementation thực tế, cần xác định người gọi qua session/IP
        # Hiện tại demo với người chơi đầu tiên
        caller_player_id = list(room_info['players'].keys())[0]
        caller_data = room_info['players'][caller_player_id]

        # Bước 2: Kiểm tra người chơi có lá bài trùng với tham số đầu (card1_value) không
        matching_cards_in_hand = []
        for i, card in enumerate(caller_data['cards']):
            if card['value'] == card1_value:
                matching_cards_in_hand.append((i, card))  # (index_in_hand, card_data)

        if not matching_cards_in_hand:
            # Người chơi không có lá card1_value
            socketio.emit('show_toast', {
                'message': f'Lá bài {card1_value} bạn không có!',
                'type': 'error'
            }, to=caller_player_id)
            return redirect(url_for('join_via_url', room_id=room_id))

        # Bước 3: Nếu có 2 lá trùng thì chỉ quan tâm 1 lá (lá đầu tiên)
        card_to_swap_index, old_card = matching_cards_in_hand[0]

        # Bước 4: Tìm trong bộ bài còn lại có lá nào trùng với tham số 2 (card2_value) không
        total_cards = 52 * room_info['decks']
        all_used_cards = room_info['used_cards']
        available_indices = [i for i in range(total_cards) if i not in all_used_cards]

        card2_available_indices = []
        for idx in available_indices:
            value = (idx % 13) + 1
            if value == card2_value:
                card2_available_indices.append(idx)

        if not card2_available_indices:
            # Không còn lá card2_value trong bộ bài
            socketio.emit('show_toast', {
                'message': f'Trong bộ bài không còn lá {card2_value}!',
                'type': 'error'
            }, to=caller_player_id)
            return redirect(url_for('join_via_url', room_id=room_id))

        # Bước 5: Thực hiện hoán đổi và cập nhật realtime
        old_card_index = old_card['index']
        new_card_index = random.choice(card2_available_indices)

        # Tạo lá bài mới
        new_value = (new_card_index % 13) + 1
        new_suit = new_card_index // 13
        new_card = {'value': new_value, 'suit': new_suit, 'index': new_card_index}

        # Cập nhật bài của người chơi
        caller_data['cards'][card_to_swap_index] = new_card
        current_round = db.get_current_round_number(room_id)
        db.update_player_cards(caller_player_id, caller_data['cards'], room_id, current_round)

        # Cập nhật danh sách bài đã dùng
        used_cards = all_used_cards[:]
        if old_card_index in used_cards:
            used_cards.remove(old_card_index)
        used_cards.append(new_card_index)
        db.update_room_used_cards(room_id, used_cards)

        # Thông báo thành công
        socketio.emit('show_toast', {
            'message': f'Đã hoán bài {card1_value} thành {card2_value}!',
            'type': 'success'
        }, to=caller_player_id)

        # Emit event cập nhật realtime cho tất cả người chơi trong phòng
        socketio.emit('card_swapped', {
            'player_id': caller_player_id,
            'card_index': card_to_swap_index,
            'used_cards': used_cards,
            'result': 'success',
            'message': 'Hoán bài thành công',
            'new_card': new_card,
            'reset_chant_count': False
        }, room=room_id)

        # Redirect back to game page
        return redirect(url_for('join_via_url', room_id=room_id))

def parse_card_value(card_str):
    """Parse card value from string (1-10, j, q, k) to integer"""
    card_str = card_str.lower()
    if card_str == 'j':
        return 11
    elif card_str == 'q':
        return 12
    elif card_str == 'k':
        return 13
    else:
        try:
            val = int(card_str)
            if 1 <= val <= 10:
                return val
            else:
                return None
        except ValueError:
            return None

def clean_database():
    """Clean up old database records every Sunday at 00:00"""
    try:
        print("[CLEANUP] Starting database cleanup...")
        # Clean up old game sessions (older than 7 days)
        # Clean up inactive rooms
        # Clean up old player data

        # For now, just log the cleanup
        print("[CLEANUP] Database cleanup completed")
    except Exception as e:
        print(f"[CLEANUP] Error during cleanup: {e}")

def schedule_weekly_cleanup():
    """Schedule database cleanup every Sunday at 00:00"""
    schedule.every().sunday.at("00:00").do(clean_database)

    def run_scheduler():
        while True:
            schedule.run_pending()
            time.sleep(60)  # Check every minute

    # Run scheduler in background thread
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    print("[SCHEDULER] Weekly cleanup scheduler started - runs every Sunday at 00:00")

@socketio.on('create_room')
def create_room(data):
    """Create a new room with settings"""
    room_id = generate_room_id()
    mode = data.get('mode', 3)  # 3 or 6 cards
    max_boosts = data.get('max_boosts', 3)  # Maximum boost uses per round
    decks = data.get('decks', 1)  # Number of decks (1 or 2)

    # Create room in database
    db.create_room(room_id, mode, max_boosts, decks)

    # Auto-generate player name
    player_name = 'Player1'

    join_room(room_id)
    # For room creator, don't set identifier yet - will be set on first join
    db.add_player(request.sid, room_id, player_name, None)

    print(f"[ROOM] Room '{room_id}' created by {player_name}")
    print(f"  Access: http://localhost:5000/room/{room_id}")
    print(f"  Network: http://{get_local_ip()}:5000/room/{room_id}")
    print()

    emit('room_created', {
        'room_id': room_id,
        'mode': mode,
        'max_boosts': max_boosts,
        'players': [{'name': player_name}]
    })

@socketio.on('join_room')
def join_room_handler(data):
    """Join an existing room"""
    room_id = data.get('room_id', '').upper()
    player_identifier = data.get('player_id', '')  # Client sends persistent ID as player_id

    # Check if room exists
    room_info = db.get_room_info(room_id)
    if not room_info:
        emit('error', {'message': 'Phòng không tồn tại!'})
        return

    # Check if this player identifier already exists (reconnection)
    is_reconnection = False
    reconnected_player_id = None  # Track the actual player ID after reconnection

    if player_identifier:
        # Check in current room players
        for pid, player_data in room_info['players'].items():
            stored_identifier = player_data.get('identifier')
            if stored_identifier == player_identifier:
                is_reconnection = True
                reconnected_player_id = pid
                # Update the player_id in database to new session ID
                db.update_player_session(pid, request.sid, room_id)
                # Reload room info after session update
                room_info = db.get_room_info(room_id)
                break
            # Also check if this is the same player (identifier is None, meaning room creator)
            # For room creator, we can't check pid == request.sid because HTTP and socket sessions are different
            # Instead, check if there's only one player with identifier = None (the room creator)
            elif stored_identifier is None:
                # Count players with identifier = None
                none_identifier_count = sum(1 for p in room_info['players'].values() if p.get('identifier') is None)
                if none_identifier_count == 1:
                    is_reconnection = True
                    reconnected_player_id = pid
                    # Update identifier for room creator
                    db.update_player_identifier(pid, player_identifier, room_id)
                    break

    if is_reconnection:
        print(f"Reconnection successful, room now has {len(room_info['players'])} players")

    join_room(room_id)

    if not is_reconnection:
        # New player - add to current round
        player_name = f'Player{len(room_info["players"]) + 1}'
        db.add_player(request.sid, room_id, player_name, player_identifier)
        # Reload room info after adding new player
        room_info = db.get_room_info(room_id)
        print(f"[JOIN] New player '{player_name}' joined room '{room_id}'")
        print(f"  Total players: {len(room_info['players'])}")

        # Notify all other players in the room about the new player
        room_stats = get_room_stats(room_info)
        emit('player_joined', {
            'player_id': request.sid,
            'player_name': player_name,
            **room_stats
        }, room=room_id, skip_sid=request.sid)
    else:
        print(f"[RECONNECT] Player reconnected to room '{room_id}'")

    # Start game for this player
    start_game_for_player(room_id, request.sid)

def start_game_for_player(room_id, player_id):
    """Start game for a specific player"""
    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    # Find player data - first try by player_id from room_info
    player = room_info['players'].get(player_id)

    # If not found in room_info, try to get from database directly (for reconnection)
    if not player:
        current_round = room_info['current_round']
        player_round_data = db.get_player_round_info(player_id, room_id, current_round)
        if player_round_data:
            # Create player dict from database data
            player = {
                'name': 'Reconnecting Player',  # This will be updated if needed
                'identifier': None,
                'cards': player_round_data['cards'],
                'chant_count': player_round_data['chant_count'],
                'folded': player_round_data['folded'],
                'ready_for_new_round': player_round_data['ready_for_new_round'],
                'flipped_cards': player_round_data['flipped_cards'],
                'completion_percentage': player_round_data['completion_percentage']
            }
            # Add to room_info for consistency
            room_info['players'][player_id] = player

    # If still not found, this might be a completely new player (shouldn't happen)
    if not player:
        return

    # Get current round number
    current_round = db.get_current_round_number(room_id)

    # Generate cards for this player if not already have
    if not player['cards']:
        cards = generate_cards(room_info['mode'], room_info['used_cards'], room_info['decks'])
        db.update_player_cards(player_id, cards, room_id, current_round)

        # Mark these cards as used in the room
        used_cards = room_info['used_cards'][:]
        for card in cards:
            used_cards.append(card['index'])
        db.update_room_used_cards(room_id, used_cards)
    else:
        cards = player['cards']

    # Collect all owned cards from all players in the room
    all_owned_cards = []
    for pid, player_data in room_info['players'].items():
        for card in player_data['cards']:
            if 'index' in card:
                all_owned_cards.append(card['index'])

    room_stats = get_room_stats(room_info)

    # Check if we should show deck suggestion popup (if less than 10 cards remaining)
    total_cards = 52 * room_info['decks']
    remaining_cards = total_cards - len(all_owned_cards)
    show_deck_suggestion = remaining_cards < 10 and room_info['decks'] < 3

    print(f"Emitting game_started to player {player_id}")
    emit('game_started', {
        'cards': cards,
        'used_cards': all_owned_cards,  # All owned cards - these are disabled for everyone
        'players_count': len(room_info['players']),
        'mode': room_info['mode'],
        'max_boosts': room_info['max_boosts'],
        'decks': room_info['decks'],
        'chant_count': player.get('chant_count', 0),
        'total_swaps': player.get('total_swaps', 0),
        'flipped_cards': player.get('flipped_cards', []),
        'folded': player.get('folded', 0) == 1,
        'show_deck_suggestion': show_deck_suggestion,
        'remaining_cards': remaining_cards,
        **room_stats
    }, to=player_id)

@socketio.on('flip_card')
def flip_card(data):
    """Handle card flip"""
    room_id = data.get('room_id', '').upper()
    card_index = data.get('card_index', -1)
    rotation = data.get('rotation', 0)

    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    player = room_info['players'].get(request.sid)
    if not player:
        return

    # Add card to flipped cards if not already flipped
    if card_index < len(player['cards']):
        flipped_cards = player.get('flipped_cards', [])
        if card_index not in flipped_cards:
            flipped_cards.append(card_index)

            # Update in database
            current_round = db.get_current_round_number(room_id)
            db.update_player_flipped_cards(request.sid, flipped_cards, room_id, current_round)

            # Update in memory
            player['flipped_cards'] = flipped_cards

            # Emit to all players to update their view
            emit('card_flipped', {
                'player_id': request.sid,
                'card_index': card_index,
                'rotation': rotation
            }, room=room_id)

@socketio.on('swap_card')
def swap_card(data):
    """Handle card swap"""
    import random
    room_id = data.get('room_id', '').upper()
    card_index = data.get('card_index', -1)

    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    player = room_info['players'].get(request.sid)
    if not player:
        return

    # Kiểm tra giới hạn số lượt hoán của player trong round này
    current_round = db.get_current_round_number(room_id)
    player_round_data = db.get_player_round_info(request.sid, room_id, current_round)

    if player_round_data and player_round_data.get('total_swaps', 0) >= room_info['max_boosts']:
        emit('swap_failed', {
            'message': f'Bạn đã dùng hết {room_info["max_boosts"]} lượt hoán trong round này!'
        }, to=request.sid)
        return

    # Perform swap
    if card_index < len(player['cards']):
        # Get available cards (not used by anyone - from database)
        room_info = db.get_room_info(room_id)
        total_cards = 52 * room_info['decks']
        all_used_cards = room_info['used_cards']  # Get fresh used_cards from DB
        available_indices = [i for i in range(total_cards) if i not in all_used_cards]

        # Logic: LUÔN có lá được trả về nếu hết cards thì dùng lá trống
        if not available_indices:
            # Không có lá nào có thể hoán - dùng lá trống
            new_card_index = -1
            print("No available cards, using blank card")
        else:
            # Get the old card index that we're replacing
            old_card_index = player['cards'][card_index]['index']

            # Check for chant boost
            chant_count = player.get('chant_count', 0)
            boost_percentage = 0
            if chant_count >= 3:
                boost_percentage = 30
            elif chant_count >= 2:
                boost_percentage = 20
            elif chant_count >= 1:
                boost_percentage = 10

            # Apply boost logic if player has chants
            if boost_percentage > 0:
                print(f"Applying {boost_percentage}% boost for player with {chant_count} chants")

                # Try to get a better card based on boost percentage
                # Higher boost = higher chance of getting desired value
                desired_value = player['cards'][card_index]['value']  # Try to improve current value

                # Filter cards that are better than current card
                better_cards = []
                good_cards = []
                for idx in available_indices:
                    value = (idx % 13) + 1
                    if value > desired_value:
                        better_cards.append(idx)
                    elif value >= desired_value - 1:  # Same or slightly worse
                        good_cards.append(idx)

                # Apply probability based on boost level
                import random
                rand = random.random() * 100

                if rand < boost_percentage and better_cards:
                    # Boost success - get better card
                    new_card_index = random.choice(better_cards)
                    print(f"Boost success! Got better card (was {desired_value}, now {(new_card_index % 13) + 1})")
                elif rand < boost_percentage + 20 and good_cards:
                    # Partial boost - get good card
                    new_card_index = random.choice(good_cards)
                    print(f"Partial boost! Got good card")
                else:
                    # Normal swap
                    new_card_index = random.choice(available_indices)
                    print(f"Normal swap (boost available but not triggered)")

                # Reset chant count after using boost
                db.update_player_chant_count(request.sid, 0, room_id, current_round)
                player['chant_count'] = 0
            else:
                # Normal swap without boost
                new_card_index = random.choice(available_indices)
                print("Normal swap without boost")

            # Handle blank card (-1)
            if new_card_index == -1:
                # Blank card - keep the same card but mark it as swapped
                new_value = player['cards'][card_index]['value']
                new_suit = player['cards'][card_index]['suit']
                print("Blank card returned - keeping same card")
            else:
                new_value = (new_card_index % 13) + 1
                new_suit = new_card_index // 13

            # Update player's card
            player['cards'][card_index] = {'value': new_value, 'suit': new_suit, 'index': new_card_index}
            current_round = db.get_current_round_number(room_id)
            db.update_player_cards(request.sid, player['cards'], room_id, current_round)

            # Update used_cards: remove old card, add new card (unless blank)
            used_cards = all_used_cards[:]
            if old_card_index in used_cards:
                used_cards.remove(old_card_index)
            # Only add new card if it's not a blank card (-1)
            if new_card_index != -1:
                used_cards.append(new_card_index)
            db.update_room_used_cards(room_id, used_cards)

            # Collect all owned cards from all players in the room
            room_info_updated = db.get_room_info(room_id)
            all_owned_cards = []
            for pid, player_data in room_info_updated['players'].items():
                for card in player_data['cards']:
                    if 'index' in card:
                        all_owned_cards.append(card['index'])

            # Update room's used_cards with all currently owned cards
            db.update_room_used_cards(room_id, all_owned_cards)

            # Increase total_swaps counter for the player
            current_total_swaps = player.get('total_swaps', 0) + 1
            db.update_player_total_swaps(request.sid, current_total_swaps, room_id, current_round)

            # Emit to all players with the complete list of owned/disabled cards
            for pid in room_info_updated['players']:
                emit('card_swapped', {
                    'player_id': request.sid,
                    'card_index': card_index,
                    'used_cards': all_owned_cards,  # All owned cards - these are disabled for everyone
                    'result': 'success',
                    'message': 'Hoán bài thành công',
                    'new_card': player['cards'][card_index],
                    'reset_chant_count': True  # Reset tỉ lệ về 1% sau mỗi swap
                }, to=pid)

@socketio.on('update_chant_count')
def update_chant_count(data):
    """Update player's chant count"""
    room_id = data.get('room_id', '').upper()
    chant_count = data.get('chant_count', 0)

    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    player = room_info['players'].get(request.sid)
    if not player:
        return

    current_round = db.get_current_round_number(room_id)
    db.update_player_chant_count(request.sid, chant_count, room_id, current_round)

    # Update in memory
    player['chant_count'] = chant_count

    # Broadcast updated chant count to all players
    emit('chant_count_updated', {
        'player_id': request.sid,
        'chant_count': chant_count
    }, room=room_id)

@socketio.on('boost_swap')
def boost_swap(data):
    """Handle boost swap with new probability logic"""
    print(f"Received boost_swap: {data}")
    room_id = data.get('room_id', '').upper()
    card_index = data.get('card_index', -1)
    desired_value = data.get('desired_value')  # Only value, no suit
    boost_level = data.get('boost_level', 1)  # 1, 2, 3, or 4 for 1%, 10%, 20%, 30%

    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    player = room_info['players'].get(request.sid)
    if not player:
        return

    # Kiểm tra giới hạn số lượt hoán của player trong round này
    current_round = db.get_current_round_number(room_id)
    player_round_data = db.get_player_round_info(request.sid, room_id, current_round)

    if player_round_data and player_round_data.get('total_swaps', 0) >= room_info['max_boosts']:
        emit('boost_failed', {
            'message': f'Bạn đã dùng hết {room_info["max_boosts"]} lượt hoán trong round này!'
        }, to=request.sid)
        return

    # Không có giới hạn số lượt tăng tỉ lệ - có thể tăng vô thời hạn

    # Perform boost swap with new logic - all levels require card selection
    if card_index < len(player['cards']):
        # Get available cards (not owned by anyone)
        room_info = db.get_room_info(room_id)
        total_cards = 52 * room_info['decks']
        all_used_cards = room_info['used_cards']
        available_indices = [i for i in range(total_cards) if i not in all_used_cards]

        # Logic mới: LUÔN có lá được trả về nếu có available_indices
        if not available_indices:
            # Không có lá nào có thể hoán - trường hợp này không nên xảy ra trong game bình thường
            emit('boost_failed', {
                'message': 'Không còn lá nào để hoán!'
            }, to=request.sid)
            return
        else:
            # Với boost level cao hơn, tăng cơ hội lấy những lá tốt hơn
            # Nhưng LUÔN có lá được trả về
            if boost_level == 1:
                # 1% - không có desired_value, chỉ random với minimum 10 cards
                minimum_pool_size = 10
                if len(available_indices) >= minimum_pool_size:
                    selected_card = random.choice(available_indices)
                else:
                    # Not enough cards - create pool with blanks
                    pool = available_indices[:]
                    blanks_needed = minimum_pool_size - len(available_indices)
                    pool.extend([-1] * blanks_needed)
                    selected_card = random.choice(pool)
            elif desired_value:
                    # Get cards of desired value from available cards
                    desired_cards = []
                    for suit in range(4):  # 4 suits
                        card_idx = (desired_value - 1) + (suit * 13)
                        if card_idx in available_indices:
                            desired_cards.append(card_idx)

                    if desired_cards:
                        # Calculate pool size based on boost level
                        minimum_pool_size = 0
                        if boost_level == 2:  # 10% - needs 10 cards minimum
                            minimum_pool_size = 10
                        elif boost_level == 3:  # 20% - needs 5 cards minimum
                            minimum_pool_size = 5
                        elif boost_level == 4:  # 30% - needs 3 cards minimum
                            minimum_pool_size = 3
                        else:  # boost_level == 1 (1%) - also needs 10 cards minimum
                            minimum_pool_size = 10

                        # Create pool: desired cards + random cards
                        pool = desired_cards[:]

                        # Add random cards that are not desired
                        non_desired_available = [idx for idx in available_indices if idx not in desired_cards]
                        remaining_needed = minimum_pool_size - len(pool)

                        if len(non_desired_available) >= remaining_needed:
                            # Enough non-desired cards - add them normally
                            additional_cards = random.sample(non_desired_available, remaining_needed)
                            pool.extend(additional_cards)
                        else:
                            # Not enough non-desired cards - add all available non-desired first
                            pool.extend(non_desired_available)
                            # Still need more cards - fill with BLANK cards (-1)
                            blanks_needed = minimum_pool_size - len(pool)
                            pool.extend([-1] * blanks_needed)

                        # Random select from pool
                        selected_card = random.choice(pool)
                    else:
                        # Không có desired cards - create pool with blanks if needed
                        minimum_pool_size = minimum_pool_size  # Same as above
                        if len(available_indices) >= minimum_pool_size:
                            selected_card = random.choice(available_indices)
                        else:
                            # Not enough cards - create pool with blanks
                            pool = available_indices[:]
                            blanks_needed = minimum_pool_size - len(available_indices)
                            pool.extend([-1] * blanks_needed)
                            selected_card = random.choice(pool)

            # Check if we got a blank card (-1)
            if selected_card == -1:
                # Got a blank card - no swap happens, keep the old card
                emit('boost_failed', {
                    'message': 'Dính lá trắng! Không hoán đổi, thử lại nhé!'
                }, to=request.sid)
                return

            # Get the old card index that we're replacing
            old_card_index = player['cards'][card_index]['index']

            # Create new card
            new_value = (selected_card % 13) + 1
            new_suit = selected_card // 13
            new_card = {'value': new_value, 'suit': new_suit, 'index': selected_card}

            # Update player's card
            player['cards'][card_index] = new_card
            current_round = db.get_current_round_number(room_id)
            db.update_player_cards(request.sid, player['cards'], room_id, current_round)

            # Update used_cards: remove old card, add new card
            used_cards = all_used_cards[:]
            if old_card_index in used_cards:
                used_cards.remove(old_card_index)
            used_cards.append(selected_card)
            db.update_room_used_cards(room_id, used_cards)

            # Collect all owned cards from all players in the room after the boost
            room_info_updated = db.get_room_info(room_id)
            all_owned_cards = []
            for pid, player_data in room_info_updated['players'].items():
                for card in player_data['cards']:
                    if 'index' in card:
                        all_owned_cards.append(card['index'])

            # Update room's used_cards with all currently owned cards
            db.update_room_used_cards(room_id, all_owned_cards)

            # Increase total_swaps counter for the player
            current_total_swaps = player.get('total_swaps', 0) + 1
            db.update_player_total_swaps(request.sid, current_total_swaps, room_id, current_round)

            # Emit to all players with the complete list of owned/disabled cards
            for pid in room_info_updated['players']:
                emit('boost_completed', {
                    'player_id': request.sid,
                    'card_index': card_index,
                    'used_cards': all_owned_cards,
                    'boosts_remaining': room_info['max_boosts'] - player.get('chant_count', 0),
                    'new_card': new_card,
                    'boost_level': boost_level,
                    'reset_chant_count': True  # Reset chant count after successful boost
                }, to=pid)
    else:
        emit('boost_failed', {
            'message': 'Lỗi: Chỉ mục lá bài không hợp lệ!'
        }, to=request.sid)

def get_room_stats(room_info):
    """Get room statistics"""
    total_players = len(room_info['players'])
    folded_count = sum(1 for player in room_info['players'].values() if player.get('folded', 0) == 1)
    ready_count = sum(1 for player in room_info['players'].values() if player.get('ready_for_new_round', 0) == 1)

    return {
        'total_players': total_players,
        'folded_count': folded_count,
        'ready_count': ready_count
    }

@socketio.on('fold')
def fold_player(data):
    """Player folds in current round"""
    room_id = data.get('room_id', '').upper()

    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    current_round = room_info['current_round']
    db.fold_player(request.sid, True, room_id, current_round)

    # Check if all players have folded
    room_info_updated = db.get_room_info(room_id)
    all_folded = all(player_data['folded'] for player_data in room_info_updated['players'].values())
    room_stats = get_room_stats(room_info_updated)

    if all_folded:
        # All players folded - show new round button
        emit('all_folded', {
            'message': 'Tất cả đã buông bài! Nhấn nút "Sẵn sàng màn mới" để bắt đầu ván tiếp theo',
            'can_start_new_round': True,
            **room_stats
        }, room=room_id)
    else:
        emit('player_folded', {
            'player_id': request.sid,
            'all_folded': False,
            **room_stats
        }, room=room_id)

@socketio.on('ready_for_new_round')
def ready_for_new_round(data):
    """Player is ready for new round"""
    room_id = data.get('room_id', '').upper()

    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    current_round = room_info['current_round']
    db.ready_player_for_new_round(request.sid, True, room_id, current_round)

    # Check if all players are ready
    room_info_updated = db.get_room_info(room_id)
    all_ready = all(player_data['ready_for_new_round'] for player_data in room_info_updated['players'].values())

    room_stats = get_room_stats(room_info_updated)

    emit('player_ready', {
        'player_id': request.sid,
        **room_stats
    }, room=room_id)

    # If all players are ready, automatically start new round
    if all_ready:
        print(f"All players ready in room {room_id}, starting new round...")
        start_new_round_logic(room_id)

def start_new_round_logic(room_id):
    """Logic to start a new round (extracted from start_new_round)"""
    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    # Start new round - this resets everything in the database
    db.start_new_round(room_id)

    # Generate new cards for all players
    room_info = db.get_room_info(room_id)  # Refresh after reset
    next_round = db.get_current_round_number(room_id)
    for player_id in room_info['players']:
        cards = generate_cards(room_info['mode'], room_info['used_cards'])
        db.update_player_cards(player_id, cards, room_id, next_round)

        # Mark these cards as used
        used_cards = room_info['used_cards'][:]
        for card in cards:
            used_cards.append(card['index'])
        db.update_room_used_cards(room_id, used_cards)

    # Reset ready status for next round
    for player_id in room_info['players']:
        db.ready_player_for_new_round(player_id, False, room_id, next_round)

    # Also reset folded status
    for player_id in room_info['players']:
        db.fold_player(player_id, False, room_id, next_round)

    # Notify all players
    socketio.emit('new_round_started', {
        'message': 'Ván mới đã bắt đầu!',
        'used_cards': room_info['used_cards'],
        'players_count': len(room_info['players'])
    }, room=room_id)

@socketio.on('swap_card_positions')
def swap_card_positions(data):
    """Handle card position swapping via drag & drop"""
    room_id = data.get('room_id', '').upper()
    from_index = data.get('from_index')
    to_index = data.get('to_index')

    if not room_id or from_index is None or to_index is None:
        emit('error', {'message': 'Invalid swap data'}, to=request.sid)
        return

    room_info = db.get_room_info(room_id)
    if not room_info:
        emit('error', {'message': 'Room not found'}, to=request.sid)
        return

    # Update card positions in database
    db.swap_card_positions(room_id, from_index, to_index)

    # Broadcast to all players in room
    emit('card_positions_swapped', {
        'from_index': from_index,
        'to_index': to_index,
        'player_id': request.sid
    }, to=room_id, skip_sid=request.sid)

@socketio.on('start_new_round')
def start_new_round(data):
    """Start a new round in the same room - reset everything"""
    room_id = data.get('room_id', '').upper()
    start_new_round_logic(room_id)

    room_info = db.get_room_info(room_id)
    if not room_info:
        return

    # Check if all players are ready for new round
    all_ready = all(player_data['ready_for_new_round'] for player_data in room_info['players'].values())

    if not all_ready:
        emit('error', {'message': 'Chưa tất cả người chơi đồng ý ván mới!'}, to=request.sid)
        return

    # Start new round - this resets everything in the database
    db.start_new_round(room_id)

    # Generate new cards for all players
    room_info = db.get_room_info(room_id)  # Refresh after reset
    next_round = db.get_current_round_number(room_id)
    for player_id in room_info['players']:
        cards = generate_cards(room_info['mode'], room_info['used_cards'])
        db.update_player_cards(player_id, cards, room_id, next_round)

        # Mark these cards as used
        used_cards = room_info['used_cards'][:]
        for card in cards:
            used_cards.append(card['index'])
        db.update_room_used_cards(room_id, used_cards)

    # Reset ready status for next round
    for player_id in room_info_updated['players']:
        db.ready_player_for_new_round(player_id, False, room_id, next_round)

    # Collect all owned cards from all players after round reset
    room_info_updated = db.get_room_info(room_id)
    all_owned_cards = []
    for pid, player_data in room_info_updated['players'].items():
        for card in player_data['cards']:
            if 'index' in card:
                all_owned_cards.append(card['index'])

    # Notify all players
    socketio.emit('new_round_started', {
        'message': 'Vòng mới đã bắt đầu!',
        'used_cards': all_owned_cards  # All owned cards after reset
    }, room=room_id)


if __name__ == '__main__':
    import os
    import ssl

    # Start weekly database cleanup scheduler
    schedule_weekly_cleanup()

    # Get port from environment variable (Fly.io sets this) or default to 5000
    port = int(os.environ.get('PORT', 5000))

    # Check if running on production platforms
    is_production = os.environ.get('FLY_APP_NAME') is not None or os.environ.get('RAILWAY_ENVIRONMENT') is not None

    # Check if SSL certificates exist for HTTPS (only for local development)
    use_https = os.path.exists('cert.pem') and os.path.exists('key.pem') and not is_production
    ssl_context = None

    if use_https:
        try:
            ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
            ssl_context.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
            print("[SSL] Certificates found - enabling HTTPS for local development")
        except Exception as e:
            print(f"[SSL] Setup failed: {e}")
            print("Falling back to HTTP")
            use_https = False

    protocol = "https" if use_https else "http"

    if is_production:
        # Production mode on Railway, Fly.io, or other platforms
        print("=" * 60)
        if os.environ.get('RAILWAY_ENVIRONMENT'):
            print("*** GAME SERVER STARTED ON RAILWAY! ***")
            print("🎉 HTTPS automatically enabled by Railway")
        elif os.environ.get('FLY_APP_NAME'):
            print("*** GAME SERVER STARTED ON FLY.IO! ***")
        else:
            print("*** GAME SERVER STARTED ON PRODUCTION! ***")
        print("=" * 60)
        print(f"Running on port {port}")
        print("🎯 Socket.IO ready for multiplayer gaming")
        print("=" * 60)
        socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
    else:
        # Development mode
        local_ip = get_local_ip()
        print("=" * 60)
        print("*** GAME SERVER STARTED! ***")
        print("=" * 60)
        if use_https:
            print("[HTTPS] ENABLED - Microphone access supported in Chrome")
            print("=" * 60)
        print(f"Local access: {protocol}://localhost:{port}")
        print(f"Network access: {protocol}://{local_ip}:{port}")
        print()
        print("How to access:")
        print(f"  - From this computer: {protocol}://localhost:{port}")
        print(f"  - From other devices: {protocol}://{local_ip}:{port}")
        print(f"  - Room URLs: {protocol}://{local_ip}:{port}/ROOM_ID")
        print()
        if use_https:
            print("IMPORTANT: First time visiting HTTPS URLs:")
            print("  Chrome will show 'Not Secure' - click 'Advanced' -> 'Proceed to localhost'")
            print("  This is normal for self-signed certificates.")
            print()
        print(f"Make sure firewall allows port {port}")
        print("Press Ctrl+C to stop server")
        print("=" * 60)
        socketio.run(app, host='0.0.0.0', port=port, debug=True, ssl_context=ssl_context)
