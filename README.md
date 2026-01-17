# Bài Ma Thuật - Multiplayer Card Game

Một game bài multiplayer với yếu tố ma thuật, hỗ trợ 2 người chơi cùng lúc.

## Tính năng

- 🏠 **Lobby System**: Tạo phòng với tùy chọn số lá bài và số boost
- 🎴 **Game Modes**: 3 hoặc 6 lá bài
- 🔮 **Magic System**: Nói thần chú để tăng tỉ lệ thành công
- 👆 **Touch Controls**: Chà màn hình để tích năng lượng
- 🌐 **Real-time Multiplayer**: Sử dụng WebSocket

## Cài đặt (Local Development)

1. **Cài đặt Python dependencies:**
```bash
pip install -r requirements.txt
```

2. **Chạy server:**
```bash
python server.py  # Sử dụng SQLite database để lưu trữ
```

3. **Truy cập game:**
Mở browser và truy cập: `http://localhost:5000`

## 🚀 Deploy lên Railway

### Chuẩn bị:
1. Tạo tài khoản Railway tại [railway.app](https://railway.app)
2. Cài đặt Railway CLI:
```bash
npm install -g @railway/cli
# hoặc
curl -fsSL https://railway.app/install.sh | sh
```

### Deploy:

#### Cách 1: Sử dụng Railway CLI
```bash
# Đăng nhập Railway
railway login

# Tạo project mới
railway init

# Deploy
railway up
```

#### Cách 2: Sử dụng GitHub (Khuyến nghị)
```bash
# Push code lên GitHub
git add .
git commit -m "Deploy to Railway"
git push origin main

# Tạo project trên Railway dashboard và connect GitHub repo
# Railway sẽ tự động deploy khi có commit mới
```

### Cấu hình Database:
Railway tự động tạo SQLite database. Nếu muốn sử dụng PostgreSQL:
```bash
# Trong Railway dashboard, add PostgreSQL database
# Railway sẽ tự động set DATABASE_URL environment variable
```

### HTTPS & Domain:
- Railway tự động cung cấp **HTTPS** miễn phí
- Tự động cấp domain dạng: `your-app-name.up.railway.app`
- Có thể custom domain trong settings

### Monitoring:
- Xem logs: `railway logs`
- Restart app: `railway restart`
- Scale app trong dashboard

### Environment Variables:
Railway tự động set:
- `PORT`: Port của server
- `RAILWAY_ENVIRONMENT`: "production"
- `DATABASE_URL`: Nếu có database

## 🔧 Production Notes

- **HTTPS Required**: Railway tự động có HTTPS, microphone sẽ hoạt động trên tất cả devices
- **WebSocket**: Socket.IO hoạt động bình thường trên Railway
- **Static Files**: Được serve tự động bởi Flask
- **Database**: SQLite ổn định cho small-scale, upgrade to PostgreSQL nếu cần

## Cách chơi

### Tạo phòng:
1. Vào http://localhost:5000
2. Chọn chế độ (3 hoặc 6 lá)
3. Chọn số boost tối đa
4. Click "Tạo phòng"
5. Sao chép URL để chia sẻ: http://localhost:5000/{ROOM_ID}

### Tham gia phòng:
1. Nhận URL từ người tạo phòng
2. Truy cập trực tiếp: http://localhost:5000/{ROOM_ID}
3. Ví dụ: http://localhost:5000/F8E9GB

### Trong game:
1. **Thời gian có hạn**: Mỗi ván có thời gian quy định (1-15 phút)
2. Chọn 1 lá bài hiện có → Click "Hoán bài" → Chọn lá bài mong muốn
3. Nói "Úm ba la xì bùa" để tăng tỉ lệ (10%-30%)
4. Chà màn hình để tích năng lượng
5. **Buông bài**: Click "Buông bài" khi không muốn thay đổi nữa
6. **Màn mới**: Khi tất cả buông bài, click "Sẵn sàng màn mới"
7. **Timer**: Đếm ngược thời gian, tự động buông bài khi hết giờ

## Công nghệ sử dụng

- **Backend**: Python Flask + Socket.IO
- **Frontend**: HTML5, CSS3, JavaScript
- **Real-time**: WebSocket
- **Speech Recognition**: Web Speech API

## Cấu trúc thư mục

```
game/
├── server.py              # Flask server
├── requirements.txt       # Python dependencies
├── templates/
│   ├── lobby.html        # Trang tạo/join phòng
│   └── game.html         # Trang game
├── static/
│   ├── css/
│   │   ├── lobby.css     # CSS cho lobby
│   │   └── game.css      # CSS cho game
│   └── js/
│       ├── lobby.js      # JS cho lobby
│       └── game.js       # JS cho game
└── README.md             # Tài liệu này
```

## Lưu ý

- Cần microphone để sử dụng tính năng nói thần chú
- Game tối ưu cho mobile và desktop
- Hỗ trợ tối đa 2 người chơi mỗi phòng

## Phát triển

Để phát triển thêm tính năng:

1. Thêm validation cho input
2. Thêm chat system
3. Thêm sound effects
4. Thêm animation cho cards
5. Thêm leaderboard

Chúc bạn chơi game vui vẻ! 🎮✨
