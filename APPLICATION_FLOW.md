# Full Stack Chat Application - Detailed Flow Documentation

## 🏗️ Architecture Overview

**Tech Stack:**
- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript
- **Backend/Database:** Supabase (PostgreSQL + Real-time subscriptions)
- **File Storage:** Cloudinary
- **Real-time Communication:** WebRTC (via simple-peer) + Supabase Realtime
- **Styling:** Tailwind CSS 4

**Key Components:**
- `app/layout.tsx` - Root layout with fonts and global styles
- `app/page.tsx` - Main application orchestrator
- `components/Auth.tsx` - Authentication UI
- `components/Sidebar.tsx` - Friends/Groups list and management
- `components/ChatWindow.tsx` - Chat interface and messaging
- `components/VideoCall.tsx` - WebRTC video/audio calling
- `components/IncomingCall.tsx` - Call notification UI

---

## 📊 Database Schema

### Tables:
1. **users** - User accounts (id, username, password, nickname, avatar, role)
2. **friends** - Bidirectional friend relationships (user_id, friend_id)
3. **friend_requests** - Pending friend requests (from_id, to_id)
4. **groups** - Chat groups (id, name, avatar, admin_id)
5. **group_members** - Group membership (group_id, user_id)
6. **messages** - All messages (id, sender_id, recipient_id, group_id, content, fileUrl, type, timestamp)

---

## 🔄 Application Flow

### 1. INITIAL APPLICATION LOAD

```
User visits app
    ↓
app/layout.tsx renders
    ├─ Loads Geist fonts
    ├─ Applies global CSS (globals.css)
    └─ Renders <html><body> structure
        ↓
app/page.tsx renders
    ├─ Checks: currentUser state = null
    └─ Renders <Auth /> component
```

**State:** `currentUser = null`

---

### 2. AUTHENTICATION FLOW

#### 2.1 Login Process
```
User enters username/password
    ↓
Auth.tsx: handleAuth() called
    ↓
Creates Supabase client (lib/supabase.ts)
    ↓
Query: SELECT * FROM users 
       WHERE username = ? AND password = ?
    ↓
If found:
    ├─ onLogin(user) called
    ├─ app/page.tsx: setCurrentUser(user)
    └─ Renders main app interface
```

#### 2.2 Registration Process
```
User clicks "Register"
    ↓
Enters username, password, nickname
    ↓
Auth.tsx: handleAuth() with isSignUp = true
    ↓
INSERT INTO users (username, password, nickname, role, avatar)
    ├─ avatar: Generated from ui-avatars.com API
    └─ role: 'user'
    ↓
Alert: "Account created! Please log in."
    ↓
Switch to login mode
```

**After Auth:** `currentUser = User object`

---

### 3. MAIN APPLICATION FLOW (Post-Authentication)

```
app/page.tsx renders main interface
    ├─ Sidebar (left)
    └─ ChatWindow (right, hidden until chat selected)
```

#### 3.1 Sidebar Initialization
```
Sidebar.tsx mounts
    ↓
useEffect triggers fetchData()
    ↓
Parallel queries:
    ├─ Query friends:
    │   └─ SELECT friend_id FROM friends WHERE user_id = currentUser.id
    │       ↓
    │   SELECT * FROM users WHERE id IN (friend_ids)
    │
    └─ Query groups:
        └─ SELECT group_id FROM group_members WHERE user_id = currentUser.id
            ↓
        SELECT * FROM groups WHERE id IN (group_ids)
    ↓
State updated:
    ├─ friends = [User, User, ...]
    └─ groups = [Group, Group, ...]
```

**Sidebar displays:**
- Current user header (avatar, nickname, settings button)
- Tabs: "Friends" | "Groups"
- List of friends or groups

---

### 4. FRIEND MANAGEMENT FLOW

#### 4.1 Adding a Friend
```
User clicks "Find New Friends"
    ↓
Sidebar: openUserSearch()
    ├─ Query: SELECT * FROM users WHERE id != currentUser.id
    └─ Filter: Remove existing friends
    ↓
Modal shows available users
    ↓
User clicks add button
    ↓
Sidebar: addFriend(targetUser)
    ├─ INSERT INTO friends (user_id, friend_id)
    │   VALUES (currentUser.id, targetUser.id)
    └─ INSERT INTO friends (user_id, friend_id)
        VALUES (targetUser.id, currentUser.id)
    ↓
fetchData() refreshes friend list
```

#### 4.2 Profile Editing
```
User clicks Settings icon
    ↓
Sidebar: showProfileModal = true
    ↓
User uploads avatar image
    ├─ handleAvatarSelect() creates preview
    └─ File stored in state
    ↓
User clicks "Save Changes"
    ↓
Sidebar: saveProfile()
    ├─ If avatar file exists:
    │   ├─ Upload to Cloudinary
    │   │   POST https://api.cloudinary.com/v1_1/{cloud_name}/image/upload
    │   │   Body: FormData (file, upload_preset)
    │   └─ Get secure_url
    │
    └─ UPDATE users 
        SET nickname = ?, avatar = ?
        WHERE id = currentUser.id
    ↓
onUpdateUser(updatedUser) called
    └─ app/page.tsx: setCurrentUser(updatedUser)
```

---

### 5. GROUP MANAGEMENT FLOW

#### 5.1 Creating a Group
```
User clicks "Create Group"
    ↓
Modal opens
    ├─ User enters group name
    └─ User selects friends (checkboxes)
    ↓
User clicks "Create Group"
    ↓
Sidebar: finalizeCreateGroup()
    ├─ INSERT INTO groups (name, admin_id)
    │   VALUES (?, currentUser.id)
    │   ↓
    │   Get new group ID
    │
    └─ INSERT INTO group_members (group_id, user_id)
        VALUES 
          (newGroup.id, currentUser.id),
          (newGroup.id, friend1.id),
          (newGroup.id, friend2.id),
          ...
    ↓
fetchData() refreshes
    ↓
onSelect(newGroup, true) - Opens group chat
```

#### 5.2 Deleting a Group
```
Admin clicks delete button
    ↓
Confirm dialog
    ↓
DELETE FROM groups WHERE id = groupId
    ↓
(CASCADE deletes group_members and messages)
    ↓
fetchData() refreshes
```

---

### 6. CHAT FLOW

#### 6.1 Opening a Chat
```
User clicks friend/group in Sidebar
    ↓
app/page.tsx: onSelect(chat, isGroup)
    ├─ setActiveChat(chat)
    └─ setIsGroup(isGroup)
    ↓
ChatWindow.tsx receives props
    ↓
useEffect triggers on activeChat.id change
    ├─ setMessages([]) - Clear previous messages
    └─ fetchHistory() called
```

#### 6.2 Fetching Chat History
```
ChatWindow: fetchHistory()
    ↓
Build query based on chat type:
    
    IF isGroup:
        SELECT *, sender:users!sender_id(username, avatar)
        FROM messages
        WHERE group_id = activeChat.id
          AND recipient_id IS NULL
        ORDER BY timestamp ASC
    
    ELSE (Direct Message):
        SELECT *, sender:users!sender_id(username, avatar)
        FROM messages
        WHERE group_id IS NULL
          AND (
            (sender_id = currentUser.id AND recipient_id = activeChat.id)
            OR
            (sender_id = activeChat.id AND recipient_id = currentUser.id)
          )
        ORDER BY timestamp ASC
    ↓
setMessages(data)
```

#### 6.3 Real-time Message Listening
```
ChatWindow mounts
    ↓
useEffect sets up Supabase Realtime listener
    ↓
supabase.channel('global-chat-listener')
    .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
    }, handleNewMessage)
    ↓
When new message inserted in DB:
    ├─ Check if message is relevant:
    │   ├─ Group: group_id matches AND recipient_id is null
    │   └─ DM: sender/recipient match current chat
    │
    ├─ Fetch sender data if needed
    └─ Add to messages state
        setMessages(prev => [...prev, newMessage])
```

#### 6.4 Sending a Message
```
User types message OR uploads file
    ↓
User clicks Send OR presses Enter
    ↓
ChatWindow: handleSend()
    ├─ Optimistic Update:
    │   └─ Add message to UI immediately (with temp ID)
    │
    ├─ IF file upload:
    │   └─ handleUpload() already called
    │       ├─ Upload to Cloudinary
    │       └─ Calls handleSend(fileUrl, type, fileName)
    │
    └─ INSERT INTO messages
        (sender_id, recipient_id, group_id, content, fileUrl, type, timestamp)
        VALUES (currentUser.id, ?, ?, ?, ?, ?, NOW())
    ↓
    IF error:
        └─ Remove optimistic message
    ELSE:
        └─ Replace temp ID with real ID from DB
    ↓
Real-time listener picks up INSERT
    └─ All connected clients receive new message
```

#### 6.5 File Upload Flow
```
User clicks image/file icon
    ↓
File input opens
    ↓
User selects file
    ↓
ChatWindow: handleUpload(e, fileType)
    ├─ setUploading(true)
    ├─ Create FormData
    │   ├─ Append file
    │   └─ Append upload_preset
    │
    └─ POST to Cloudinary
        https://api.cloudinary.com/v1_1/{cloud_name}/auto/upload
        ↓
        Response: { secure_url, ... }
        ↓
    handleSend(secure_url, fileType, file.name)
    └─ setUploading(false)
```

---

### 7. VIDEO/AUDIO CALLING FLOW

#### 7.1 Initiating a Call
```
User clicks Phone/Video button in ChatWindow
    ↓
VideoCall.tsx: startCall(type)
    ├─ notifyReceiver(type)
    │   └─ Supabase channel: notifications-{recipientId}
    │       └─ Broadcast: { caller, roomId, callType }
    │
    └─ joinRoom(type)
        ├─ Request media access:
        │   navigator.mediaDevices.getUserMedia({
        │     video: type === 'video',
        │     audio: true
        │   })
        │
        ├─ Store stream in localStream.current
        ├─ Display local video (if video call)
        └─ Join Supabase channel: call:{roomId}
        │   └─ Send: { type: 'join', senderId, mode }
```

#### 7.2 Receiving a Call
```
Recipient's app/page.tsx:
    ↓
useEffect listens on channel: notifications-{currentUser.id}
    ↓
Receives broadcast: 'incoming-call'
    ↓
setIncomingCall(payload)
    ↓
IncomingCall component renders
    ├─ Shows caller info
    ├─ Plays ringtone
    └─ Accept/Decline buttons
```

#### 7.3 Accepting a Call
```
User clicks Accept
    ↓
app/page.tsx: acceptCall()
    ├─ setActiveChat(caller)
    ├─ setIsGroup(false)
    ├─ setAcceptedCallMode(callType)
    └─ setIncomingCall(null)
    ↓
ChatWindow receives acceptedCallMode prop
    ↓
VideoCall component:
    ├─ useEffect detects incomingMode
    └─ joinRoom(incomingMode)
```

#### 7.4 WebRTC Connection Establishment
```
Both users in room
    ↓
User A sends: { type: 'join', senderId: A, mode }
    ↓
User B receives join signal
    ↓
VideoCall: handleSignal()
    ├─ Creates RTCPeerConnection
    ├─ Adds local stream tracks
    ├─ Creates offer
    └─ Sends: { type: 'offer', sdp, senderId: B, targetId: A }
    ↓
User A receives offer
    ├─ setRemoteDescription(offer)
    ├─ createAnswer()
    ├─ setLocalDescription(answer)
    └─ Sends: { type: 'answer', sdp, senderId: A, targetId: B }
    ↓
User B receives answer
    ├─ setRemoteDescription(answer)
    └─ Connection established
    ↓
ICE candidates exchanged
    └─ { type: 'candidate', candidate, senderId, targetId }
    ↓
Both users see each other's streams
```

#### 7.5 Ending a Call
```
User clicks "End Call"
    ↓
VideoCall: handleEndCallClick()
    ├─ Send: { type: 'leave', senderId }
    ├─ cleanupMedia()
    │   ├─ Stop all media tracks
    │   ├─ Close all peer connections
    │   └─ Clear peers state
    │
    └─ setInCall(false)
    ↓
Other users receive 'leave' signal
    └─ If DM: End call for them too
        If Group: Remove that peer only
```

---

### 8. STATE MANAGEMENT FLOW

#### 8.1 App-Level State (app/page.tsx)
```typescript
currentUser: User | null
  └─ Controls: Auth vs Main App

activeChat: User | Group | null
  └─ Controls: Which chat is open

isGroup: boolean
  └─ Controls: Chat type (DM vs Group)

incomingCall: { caller, callType, roomId } | null
  └─ Controls: Incoming call modal

acceptedCallMode: 'audio' | 'video' | null
  └─ Controls: Auto-join call on chat open
```

#### 8.2 Sidebar State
```typescript
friends: User[]
groups: Group[]
view: 'friends' | 'groups'
showFriendModal: boolean
showGroupModal: boolean
showProfileModal: boolean
```

#### 8.3 ChatWindow State
```typescript
messages: Message[]
text: string
uploading: boolean
loadingChat: boolean
```

#### 8.4 VideoCall State
```typescript
inCall: boolean
callType: 'audio' | 'video'
peers: Array<{ id: number, stream: MediaStream }>
localStream: MediaStream | null
peerConnections: { [userId: string]: RTCPeerConnection }
```

---

### 9. RESPONSIVE DESIGN FLOW

#### Mobile View:
```
- Sidebar: Hidden when chat active (w-full when visible)
- ChatWindow: Hidden when no chat (w-full when active)
- Back button: Visible in chat header
```

#### Desktop View:
```
- Sidebar: Always visible (fixed width: w-80)
- ChatWindow: Always visible (flex-1)
- Back button: Hidden
```

---

### 10. ERROR HANDLING & EDGE CASES

#### 10.1 Authentication Errors
- Invalid credentials → Alert message
- Missing env vars → Error thrown in createClient()

#### 10.2 Message Errors
- Failed send → Optimistic update removed
- Network error → User sees error state

#### 10.3 Media Errors
- No camera/mic access → Alert + cleanup
- WebRTC failure → Graceful degradation

#### 10.4 Real-time Sync
- Duplicate messages prevented by checking message ID
- Reconnection handled by Supabase client

---

## 🔐 Security Considerations

**Current Implementation (Demo):**
- Passwords stored in plain text (⚠️ NOT for production)
- RLS policies allow all access (⚠️ NOT for production)
- Client-side database access

**Production Recommendations:**
- Hash passwords (bcrypt/argon2)
- Implement proper RLS policies
- Use Supabase Auth for authentication
- Server-side API routes for sensitive operations
- Input validation and sanitization

---

## 📱 Key Features Summary

1. ✅ User Authentication (Login/Register)
2. ✅ Friend Management (Add, View)
3. ✅ Group Chat Creation & Management
4. ✅ Real-time Messaging (Text, Images, Files)
5. ✅ Video/Audio Calling (WebRTC)
6. ✅ Profile Management (Avatar, Nickname)
7. ✅ File Uploads (Cloudinary)
8. ✅ Responsive Design (Mobile/Desktop)
9. ✅ Real-time Updates (Supabase Realtime)

---

## 🚀 Performance Optimizations

1. **Optimistic Updates:** Messages appear instantly
2. **Lazy Loading:** Components load on demand
3. **Refs for Refs:** Avoid unnecessary re-renders
4. **Indexed Queries:** Database indexes on foreign keys
5. **Efficient Realtime:** Single channel for all messages

---

This application demonstrates a full-stack real-time chat system with modern web technologies, real-time synchronization, and peer-to-peer communication capabilities.











