'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { User, Group } from '@/types'
import { UserPlus, Users, MessageSquare, X, Search, Check, Plus, Trash2, Settings, Camera, Loader2, Save } from 'lucide-react'

interface SidebarProps {
  currentUser: User;
  onSelect: (chat: any, isGroup: boolean) => void;
  onUpdateUser: (updatedUser: User) => void; // New Prop
}

export default function Sidebar({ currentUser, onSelect, onUpdateUser }: SidebarProps) {
  const [friends, setFriends] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [view, setView] = useState<'friends' | 'groups'>('friends')
  
  // Modal States
  const [showFriendModal, setShowFriendModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false) // New Modal State
  
  // Data States
  const [availableUsers, setAvailableUsers] = useState<User[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [selectedFriendIds, setSelectedFriendIds] = useState<number[]>([])

  // Profile Edit States
  const [editNickname, setEditNickname] = useState('')
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null)
  const [editAvatarPreview, setEditAvatarPreview] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [currentUser])

  // --- Initialize Profile Modal Data ---
  useEffect(() => {
    if (showProfileModal) {
      setEditNickname(currentUser.nickname || currentUser.username)
      setEditAvatarPreview(currentUser.avatar)
      setEditAvatarFile(null)
    }
  }, [showProfileModal, currentUser])

  const fetchData = async () => {
    // 1. Fetch Friends
    const { data: friendLinks } = await supabase.from('friends').select('friend_id').eq('user_id', currentUser.id)
    let currentFriendIds: number[] = []
    
    if (friendLinks) {
      currentFriendIds = friendLinks.map((f: any) => f.friend_id)
      if (currentFriendIds.length > 0) {
        const { data: friendList } = await supabase.from('users').select('*').in('id', currentFriendIds)
        if (friendList) setFriends(friendList as User[])
      } else {
        setFriends([])
      }
    }

    // 2. Fetch Groups
    const { data: groupLinks } = await supabase.from('group_members').select('group_id').eq('user_id', currentUser.id)
    if (groupLinks && groupLinks.length > 0) {
      const gIds = groupLinks.map((g: any) => g.group_id)
      const { data: groupList } = await supabase.from('groups').select('*').in('id', gIds)
      if (groupList) setGroups(groupList as Group[])
    } else {
      setGroups([])
    }
  }

  // --- Logic ---
  const openUserSearch = async () => {
    setShowFriendModal(true)
    const { data: allUsers } = await supabase.from('users').select('*').neq('id', currentUser.id)
    if (allUsers) {
      const friendIds = friends.map(f => f.id)
      const nonFriends = allUsers.filter((u: any) => !friendIds.includes(u.id))
      setAvailableUsers(nonFriends as User[])
    }
  }

  const addFriend = async (targetUser: User) => {
    await supabase.from('friends').insert([{ user_id: currentUser.id, friend_id: targetUser.id }])
    await supabase.from('friends').insert([{ user_id: targetUser.id, friend_id: currentUser.id }])
    setShowFriendModal(false)
    fetchData()
  }

  const toggleFriendSelection = (friendId: number) => {
    setSelectedFriendIds(prev => 
      prev.includes(friendId) ? prev.filter(id => id !== friendId) : [...prev, friendId]
    )
  }

  const finalizeCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("Please enter a group name")
    
    const { data: newGroup, error } = await supabase.from('groups').insert({ name: newGroupName, admin_id: currentUser.id }).select().single()
    if (error || !newGroup) return alert("Failed to create group")

    const members = [
      { group_id: newGroup.id, user_id: currentUser.id },
      ...selectedFriendIds.map(fid => ({ group_id: newGroup.id, user_id: fid }))
    ]
    await supabase.from('group_members').insert(members)
    setShowGroupModal(false)
    setNewGroupName('')
    setSelectedFriendIds([])
    fetchData()
    onSelect(newGroup, true)
  }

  const deleteGroup = async (groupId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Delete group?")) return
    const { error } = await supabase.from('groups').delete().eq('id', groupId)
    if (!error) fetchData()
  }

  // --- UPDATE PROFILE LOGIC ---
  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setEditAvatarFile(file)
      setEditAvatarPreview(URL.createObjectURL(file))
    }
  }

  const saveProfile = async () => {
    setIsUpdating(true)
    let finalAvatarUrl = currentUser.avatar

    try {
      // 1. Upload new image if selected
      if (editAvatarFile) {
        const formData = new FormData()
        formData.append('file', editAvatarFile)
        formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!)
        
        const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData })
        const data = await res.json()
        if (data.secure_url) finalAvatarUrl = data.secure_url
      }

      // 2. Update Supabase
      const { data, error } = await supabase
        .from('users')
        .update({ nickname: editNickname, avatar: finalAvatarUrl })
        .eq('id', currentUser.id)
        .select()
        .single()

      if (error) throw error

      // 3. Update Parent State & Close
      if (data) {
        onUpdateUser(data as User)
        setShowProfileModal(false)
      }
    } catch (error) {
      console.error(error)
      alert("Failed to update profile")
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="w-80 bg-gray-900 border-r border-gray-800 flex flex-col h-screen">
      {/* Current User Header */}
      <div className="p-4 bg-gray-950 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={currentUser.avatar} className="w-12 h-12 rounded-full border-2 border-green-500 object-cover" />
          <div>
            <h3 className="font-bold text-white max-w-[120px] truncate">{currentUser.nickname || currentUser.username}</h3>
            <span className="text-xs text-green-400">Online</span>
          </div>
        </div>
        {/* Settings Button */}
        <button 
          onClick={() => setShowProfileModal(true)}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors"
          title="Edit Profile"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex p-2 gap-2 bg-gray-900 border-b border-gray-800">
        <button onClick={() => setView('friends')} className={`flex-1 p-2 rounded text-sm flex items-center justify-center gap-2 ${view === 'friends' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
          <Users size={16} /> Friends
        </button>
        <button onClick={() => setView('groups')} className={`flex-1 p-2 rounded text-sm flex items-center justify-center gap-2 ${view === 'groups' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
          <MessageSquare size={16} /> Groups
        </button>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {view === 'friends' ? (
          <>
             <button onClick={openUserSearch} className="w-full mb-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 p-2 rounded flex items-center justify-center gap-2 transition-colors">
                <Search size={16} /> Find New Friends
             </button>
             {friends.map(f => (
               <div key={f.id} onClick={() => onSelect(f, false)} className="p-3 hover:bg-gray-800 rounded-lg cursor-pointer flex items-center gap-3 transition-colors">
                 <img src={f.avatar} className="w-10 h-10 rounded-full bg-gray-700 object-cover" />
                 <div>
                   <p className="text-gray-200 font-medium">{f.nickname || f.username}</p>
                   <p className="text-xs text-gray-500">@{f.username}</p>
                 </div>
               </div>
             ))}
          </>
        ) : (
          <>
            <button onClick={() => setShowGroupModal(true)} className="w-full mb-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 p-2 rounded flex items-center justify-center gap-2 transition-colors">
              <Plus size={16} /> Create Group
            </button>
            {groups.map(g => (
               <div key={g.id} onClick={() => onSelect(g, true)} className="group p-3 hover:bg-gray-800 rounded-lg cursor-pointer flex items-center justify-between transition-colors">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">{g.name[0].toUpperCase()}</div>
                   <span className="text-gray-200 font-medium">{g.name}</span>
                 </div>
                 {g.admin_id === currentUser.id && (
                   <button onClick={(e) => deleteGroup(g.id, e)} className="text-gray-500 hover:text-red-500 hover:bg-red-500/10 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all">
                     <Trash2 size={16} />
                   </button>
                 )}
               </div>
             ))}
          </>
        )}
      </div>

      {/* --- PROFILE EDIT MODAL --- */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-900 w-full max-w-sm rounded-xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
              <h3 className="text-white font-bold text-lg">Edit Profile</h3>
              <button onClick={() => setShowProfileModal(false)} className="text-gray-400 hover:text-white"><X size={20}/></button>
            </div>
            
            <div className="p-6 flex flex-col items-center gap-6">
              {/* Avatar Upload */}
              <div className="relative group cursor-pointer">
                <img src={editAvatarPreview} className="w-32 h-32 rounded-full object-cover border-4 border-gray-800 group-hover:opacity-50 transition-opacity" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="text-white" size={32} />
                </div>
                <input 
                  type="file" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                  accept="image/*"
                  onChange={handleAvatarSelect}
                />
              </div>
              
              <div className="w-full space-y-2">
                <label className="text-xs text-gray-400 uppercase font-bold">Nickname</label>
                <input 
                  className="w-full bg-gray-800 text-white p-3 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500"
                  value={editNickname}
                  onChange={e => setEditNickname(e.target.value)}
                  placeholder="Enter nickname"
                />
              </div>

              <div className="w-full space-y-2">
                <label className="text-xs text-gray-500 uppercase font-bold">Username</label>
                 <input 
                  className="w-full bg-gray-800/50 text-gray-500 p-3 rounded-lg border border-gray-800 cursor-not-allowed"
                  value={currentUser.username}
                  disabled
                  title="Username cannot be changed"
                />
              </div>
            </div>

            <div className="p-4 border-t border-gray-800 bg-gray-900">
              <button 
                onClick={saveProfile} 
                disabled={isUpdating}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isUpdating ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- OTHER MODALS (Friend / Group) --- */}
      {showFriendModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-900 w-full max-w-md rounded-xl border border-gray-700 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center">
              <h3 className="text-white font-bold text-lg">Add a Friend</h3>
              <button onClick={() => setShowFriendModal(false)} className="text-gray-400 hover:text-white"><X size={20}/></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {availableUsers.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3 hover:bg-gray-800 rounded-lg group">
                    <div className="flex items-center gap-3">
                      <img src={u.avatar} className="w-10 h-10 rounded-full" />
                      <div><p className="text-white font-medium">{u.nickname || u.username}</p></div>
                    </div>
                    <button onClick={() => addFriend(u)} className="bg-blue-600 p-2 rounded-full text-white hover:bg-blue-500"><UserPlus size={18} /></button>
                  </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showGroupModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-900 w-full max-w-md rounded-xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
              <h3 className="text-white font-bold text-lg">Create New Group</h3>
              <button onClick={() => setShowGroupModal(false)} className="text-gray-400 hover:text-white"><X size={20}/></button>
            </div>
            <div className="p-4 overflow-y-auto">
              <input className="w-full bg-gray-800 text-white p-3 rounded-lg border border-gray-700 mb-6" placeholder="Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
              <label className="block text-xs text-gray-400 mb-2 uppercase font-bold">Select Members</label>
              <div className="space-y-1">
                {friends.map(f => {
                  const isSelected = selectedFriendIds.includes(f.id)
                  return (
                    <div key={f.id} onClick={() => toggleFriendSelection(f.id)} className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-blue-900/30 border border-blue-600/50' : 'hover:bg-gray-800 border border-transparent'}`}>
                      <div className="flex items-center gap-3"><img src={f.avatar} className="w-10 h-10 rounded-full" /><span className={`font-medium ${isSelected ? 'text-blue-400' : 'text-gray-300'}`}>{f.nickname || f.username}</span></div>
                      {isSelected && <Check size={14} className="text-white" />}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="p-4 border-t border-gray-800 bg-gray-900">
              <button onClick={finalizeCreateGroup} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg">Create Group</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
