import sqlite3
import json
import time
from datetime import datetime

class GameDatabase:
    def __init__(self, db_path='game.db'):
        self.db_path = db_path
        self.init_database()

    def init_database(self):
        """Create database tables if they don't exist"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    mode INTEGER NOT NULL,  -- 3 or 6 cards
                    max_boosts INTEGER NOT NULL,
                    decks INTEGER DEFAULT 1,  -- Number of decks (1 or 2)
                    used_cards TEXT DEFAULT '[]',  -- JSON array of used card indices
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            conn.execute('''
                CREATE TABLE IF NOT EXISTS room_players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id TEXT NOT NULL,  -- session ID
                    room_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    identifier TEXT,  -- persistent player identifier for reconnection
                    round_number INTEGER NOT NULL DEFAULT 1,
                    cards TEXT DEFAULT '[]',  -- JSON array of cards
                    chant_count INTEGER DEFAULT 0,  -- Number of successful chants (also used for boost count)
                    total_swaps INTEGER DEFAULT 0,  -- Total number of swaps done by player in this round
                    folded INTEGER DEFAULT 0,
                    ready_for_new_round INTEGER DEFAULT 0,
                    flipped_cards TEXT DEFAULT '[]',  -- JSON array
                    completion_percentage REAL DEFAULT 0.0,
                    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (room_id) REFERENCES rooms(id),
                    UNIQUE(player_id, room_id, round_number)
                )
            ''')

    def create_room(self, room_id, mode, max_boosts, decks=1):
        """Create a new room with settings"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT INTO rooms (id, mode, max_boosts, decks)
                VALUES (?, ?, ?, ?)
            ''', (room_id, mode, max_boosts, decks))

    def add_player(self, player_id, room_id, name, identifier=None):
        """Add a player to a room"""
        with sqlite3.connect(self.db_path) as conn:
            # Create initial room player entry for round 1
            conn.execute('''
                INSERT OR IGNORE INTO room_players (player_id, room_id, name, identifier, round_number)
                VALUES (?, ?, ?, ?, 1)
            ''', (player_id, room_id, name, identifier))

    def get_room_info(self, room_id):
        """Get room information"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT mode, max_boosts, decks, used_cards
                FROM rooms
                WHERE id = ?
            ''', (room_id,))
            row = cursor.fetchone()

            if row:
                mode, max_boosts, decks, used_cards_json = row
                current_round = self.get_current_round_number(room_id)
                players = self.get_room_players(room_id, current_round)
                used_cards = json.loads(used_cards_json) if used_cards_json else []

                return {
                    'mode': mode,
                    'max_boosts': max_boosts,
                    'decks': decks,
                    'current_round': current_round,
                    'used_cards': used_cards,
                    'players': players
                }
            return None

    def get_room_players(self, room_id, round_number=1):
        """Get all players in a room for a specific round"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT player_id, name, identifier, cards, chant_count, total_swaps, folded,
                       ready_for_new_round, flipped_cards, completion_percentage
                FROM room_players
                WHERE room_id = ? AND round_number = ?
                ORDER BY joined_at ASC
            ''', (room_id, round_number))
            rows = cursor.fetchall()

            players = {}
            for row in rows:
                player_id, name, identifier, cards_json, chant_count, total_swaps, folded, ready_for_new_round, flipped_cards_json, completion_percentage = row
                cards = json.loads(cards_json) if cards_json else []
                flipped_cards = json.loads(flipped_cards_json) if flipped_cards_json else []
                players[player_id] = {
                    'name': name,
                    'identifier': identifier,
                    'cards': cards,
                    'chant_count': chant_count or 0,
                    'total_swaps': total_swaps or 0,
                    'folded': bool(folded or 0),
                    'ready_for_new_round': bool(ready_for_new_round or 0),
                    'flipped_cards': flipped_cards,
                    'completion_percentage': completion_percentage or 0.0
                }
            return players

    def update_player_cards(self, player_id, cards, room_id=None, round_number=1):
        """Update player's cards for a specific round"""
        with sqlite3.connect(self.db_path) as conn:
            if room_id:
                conn.execute('''
                    UPDATE room_players
                    SET cards = ?
                    WHERE player_id = ? AND room_id = ? AND round_number = ?
                ''', (json.dumps(cards), player_id, room_id, round_number))
            else:
                # Legacy support - find room_id from room_players table
                cursor = conn.cursor()
                cursor.execute('SELECT room_id FROM room_players WHERE player_id = ? ORDER BY joined_at DESC LIMIT 1', (player_id,))
                row = cursor.fetchone()
                if row:
                    room_id = row[0]
                    conn.execute('''
                        UPDATE room_players
                        SET cards = ?
                        WHERE player_id = ? AND room_id = ? AND round_number = ?
                    ''', (json.dumps(cards), player_id, room_id, round_number))


    def update_room_used_cards(self, room_id, used_cards):
        """Update used cards for a room (cards that are owned by players)"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                UPDATE rooms
                SET used_cards = ?
                WHERE id = ?
            ''', (json.dumps(used_cards), room_id))

    def update_player_flipped_cards(self, player_id, flipped_cards, room_id=None, round_number=1):
        """Update player's flipped cards for a specific round"""
        with sqlite3.connect(self.db_path) as conn:
            if room_id:
                conn.execute('''
                    UPDATE room_players
                    SET flipped_cards = ?
                    WHERE player_id = ? AND room_id = ? AND round_number = ?
                ''', (json.dumps(flipped_cards), player_id, room_id, round_number))
            else:
                # Legacy support
                cursor = conn.cursor()
                cursor.execute('SELECT room_id FROM players WHERE id = ?', (player_id,))
                row = cursor.fetchone()
                if row:
                    room_id = row[0]
                    conn.execute('''
                        UPDATE room_players
                        SET flipped_cards = ?
                        WHERE player_id = ? AND room_id = ? AND round_number = ?
                    ''', (json.dumps(flipped_cards), player_id, room_id, round_number))


    def update_player_chant_count(self, player_id, chant_count, room_id=None, round_number=1):
        """Update player's chant count for a specific round"""
        with sqlite3.connect(self.db_path) as conn:
            if room_id:
                conn.execute('''
                    UPDATE room_players
                    SET chant_count = ?
                    WHERE player_id = ? AND room_id = ? AND round_number = ?
                ''', (chant_count, player_id, room_id, round_number))
            else:
                # Legacy support
                cursor = conn.cursor()
                cursor.execute('SELECT room_id FROM room_players WHERE player_id = ? ORDER BY joined_at DESC LIMIT 1', (player_id,))
                row = cursor.fetchone()
                if row:
                    room_id = row[0]
                    conn.execute('''
                        UPDATE room_players
                        SET chant_count = ?
                        WHERE player_id = ? AND room_id = ? AND round_number = ?
                    ''', (chant_count, player_id, room_id, round_number))

    def update_player_total_swaps(self, player_id, total_swaps, room_id=None, round_number=1):
        """Update player's total swaps count for a specific round"""
        with sqlite3.connect(self.db_path) as conn:
            if room_id:
                conn.execute('''
                    UPDATE room_players
                    SET total_swaps = ?
                    WHERE player_id = ? AND room_id = ? AND round_number = ?
                ''', (total_swaps, player_id, room_id, round_number))
            else:
                # Legacy support
                cursor = conn.cursor()
                cursor.execute('SELECT room_id FROM room_players WHERE player_id = ? ORDER BY joined_at DESC LIMIT 1', (player_id,))
                row = cursor.fetchone()
                if row:
                    room_id = row[0]
                    conn.execute('''
                        UPDATE room_players
                        SET total_swaps = ?
                        WHERE player_id = ? AND room_id = ? AND round_number = ?
                    ''', (total_swaps, player_id, room_id, round_number))

    def update_player_session(self, old_player_id, new_player_id, room_id):
        """Update player session ID when reconnecting"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                UPDATE room_players
                SET player_id = ?
                WHERE player_id = ? AND room_id = ?
            ''', (new_player_id, old_player_id, room_id))
            conn.commit()

    def update_player_identifier(self, player_id, new_identifier, room_id):
        """Update player identifier"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                UPDATE room_players
                SET identifier = ?
                WHERE player_id = ? AND room_id = ?
            ''', (new_identifier, player_id, room_id))
            conn.commit()

    def fold_player(self, player_id, folded=True, room_id=None, round_number=1):
        """Mark player as folded for a specific round"""
        with sqlite3.connect(self.db_path) as conn:
            if room_id:
                conn.execute('''
                    UPDATE room_players
                    SET folded = ?
                    WHERE player_id = ? AND room_id = ? AND round_number = ?
                ''', (folded, player_id, room_id, round_number))
            else:
                # Legacy support
                cursor = conn.cursor()
                cursor.execute('SELECT room_id FROM room_players WHERE player_id = ? ORDER BY joined_at DESC LIMIT 1', (player_id,))
                row = cursor.fetchone()
                if row:
                    room_id = row[0]
                    conn.execute('''
                        UPDATE room_players
                        SET folded = ?
                        WHERE player_id = ? AND room_id = ? AND round_number = ?
                    ''', (folded, player_id, room_id, round_number))

    def ready_player_for_new_round(self, player_id, ready=True, room_id=None, round_number=1):
        """Mark player as ready for new round"""
        with sqlite3.connect(self.db_path) as conn:
            if room_id:
                conn.execute('''
                    UPDATE room_players
                    SET ready_for_new_round = ?
                    WHERE player_id = ? AND room_id = ? AND round_number = ?
                ''', (ready, player_id, room_id, round_number))
            else:
                # Legacy support
                cursor = conn.cursor()
                cursor.execute('SELECT room_id FROM room_players WHERE player_id = ? ORDER BY joined_at DESC LIMIT 1', (player_id,))
                row = cursor.fetchone()
                if row:
                    room_id = row[0]
                    conn.execute('''
                        UPDATE room_players
                        SET ready_for_new_round = ?
                        WHERE player_id = ? AND room_id = ? AND round_number = ?
                    ''', (ready, player_id, room_id, round_number))

    def start_new_round(self, room_id):
        """Start a new round for the room - create new round entries"""
        with sqlite3.connect(self.db_path) as conn:
            # Reset room data
            conn.execute('''
                UPDATE rooms
                SET used_cards = '[]'
                WHERE id = ?
            ''', (room_id,))

            # Get current max round number
            cursor = conn.cursor()
            cursor.execute('SELECT MAX(round_number) FROM room_players WHERE room_id = ?', (room_id,))
            row = cursor.fetchone()
            current_round = row[0] if row[0] else 0
            next_round = current_round + 1

            # Create new round entries for all current players
            cursor.execute('SELECT player_id, name, identifier FROM room_players WHERE room_id = ? AND round_number = ? GROUP BY player_id', (room_id, current_round))
            current_players = cursor.fetchall()

            for player_id, name, identifier in current_players:
                conn.execute('''
                    INSERT INTO room_players (player_id, room_id, name, identifier, round_number, cards, chant_count, total_swaps, folded, ready_for_new_round, flipped_cards, completion_percentage)
                    VALUES (?, ?, ?, ?, ?, '[]', 0, 0, 0, 0, '[]', 0.0)
                ''', (player_id, room_id, name, identifier, next_round))

    def update_player_completion(self, player_id, percentage, room_id=None, round_number=1):
        """Update player's completion percentage for a specific round"""
        with sqlite3.connect(self.db_path) as conn:
            if room_id:
                conn.execute('''
                    UPDATE room_players
                    SET completion_percentage = ?
                    WHERE player_id = ? AND room_id = ? AND round_number = ?
                ''', (percentage, player_id, room_id, round_number))
            else:
                # Legacy support
                cursor = conn.cursor()
                cursor.execute('SELECT room_id FROM players WHERE id = ?', (player_id,))
                row = cursor.fetchone()
                if row:
                    room_id = row[0]
                    conn.execute('''
                        UPDATE room_players
                        SET completion_percentage = ?
                        WHERE player_id = ? AND room_id = ? AND round_number = ?
                    ''', (percentage, player_id, room_id, round_number))

    def get_player_round_info(self, player_id, room_id, round_number=1):
        """Get specific player round information"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT cards, chant_count, total_swaps, folded, ready_for_new_round, flipped_cards, completion_percentage
                FROM room_players
                WHERE player_id = ? AND room_id = ? AND round_number = ?
            ''', (player_id, room_id, round_number))
            row = cursor.fetchone()

            if row:
                cards_json, chant_count, total_swaps, folded, ready_for_new_round, flipped_cards_json, completion_percentage = row
                cards = json.loads(cards_json) if cards_json else []
                flipped_cards = json.loads(flipped_cards_json) if flipped_cards_json else []

                return {
                    'cards': cards,
                    'chant_count': chant_count,
                    'total_swaps': total_swaps,
                    'folded': bool(folded),
                    'ready_for_new_round': bool(ready_for_new_round),
                    'flipped_cards': flipped_cards,
                    'completion_percentage': completion_percentage
                }
            return None

    def get_current_round_number(self, room_id):
        """Get the current round number for a room"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT MAX(round_number) FROM room_players WHERE room_id = ?', (room_id,))
            row = cursor.fetchone()
            return row[0] if row[0] else 1

    def cleanup_old_rooms(self, hours=24):
        """Delete rooms older than specified hours"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                DELETE FROM rooms
                WHERE created_at < datetime('now', '-' || ? || ' hours')
            ''', (hours,))

    def swap_card_positions(self, room_id, from_index, to_index):
        """Swap card positions for all players in a room"""
        with sqlite3.connect(self.db_path) as conn:
            # Get current cards for the room
            cursor = conn.cursor()
            cursor.execute('''
                SELECT player_id, cards, flipped_cards
                FROM room_players
                WHERE room_id = ? AND round_number = (
                    SELECT MAX(round_number) FROM room_players WHERE room_id = ?
                )
            ''', (room_id, room_id))

            players = cursor.fetchall()

            for player_id, cards_json, flipped_cards_json in players:
                cards = json.loads(cards_json) if cards_json else []
                flipped_cards = json.loads(flipped_cards_json) if flipped_cards_json else []

                # Swap card positions
                if 0 <= from_index < len(cards) and 0 <= to_index < len(cards):
                    cards[from_index], cards[to_index] = cards[to_index], cards[from_index]

                    # Update flipped cards indices
                    if from_index in flipped_cards:
                        flipped_cards[flipped_cards.index(from_index)] = to_index
                    if to_index in flipped_cards:
                        flipped_cards[flipped_cards.index(to_index)] = from_index

                    # Update database
                    conn.execute('''
                        UPDATE room_players
                        SET cards = ?, flipped_cards = ?
                        WHERE player_id = ? AND room_id = ?
                    ''', (json.dumps(cards), json.dumps(flipped_cards), player_id, room_id))

# Global database instance
db = GameDatabase()
