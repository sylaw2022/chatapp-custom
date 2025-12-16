'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { User } from '@/types'
import { Phone, PhoneOff, Video as VideoIcon, Mic, UserX } from 'lucide-react'

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

interface VideoCallProps {
  currentUser: User;
  activeChat: any;
  isGroup: boolean;
  incomingMode?: 'audio' | 'video' | null;
}

export default function VideoCall({ currentUser, activeChat, isGroup, incomingMode }: VideoCallProps) {
  const [inCall, setInCall] = useState(false)
  const [callType, setCallType] = useState<'audio' | 'video'>('video') 
  const [peers, setPeers] = useState<any[]>([])
  
  const localVideo = useRef<HTMLVideoElement>(null)
  const localStream = useRef<MediaStream | null>(null)
  const peerConnections = useRef<{[key: string]: RTCPeerConnection}>({})
  const channelRef = useRef<any>(null)
  const supabase = createClient()

  const roomId = isGroup 
    ? `group-${activeChat.id}`
    : `dm-${[currentUser.id, activeChat.id].sort().join('-')}`

  // --- Auto-Answer Logic ---
  useEffect(() => {
    if (incomingMode) {
      joinRoom(incomingMode)
    }
  }, [incomingMode])

  // Cleanup on component unmount (e.g., navigating away)
  useEffect(() => {
    return () => cleanupMedia()
  }, [])

  const notifyReceiver = async (type: 'audio' | 'video') => {
    if (isGroup) return 

    const channel = supabase.channel(`notifications-${activeChat.id}`)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'incoming-call',
          payload: {
            caller: currentUser,
            roomId,
            callType: type
          }
        })
        setTimeout(() => supabase.removeChannel(channel), 5000)
      }
    })
  }

  const joinRoom = async (type: 'audio' | 'video') => {
    try {
      setCallType(type)
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: type === 'video', 
        audio: true 
      })
      localStream.current = stream
      
      if (type === 'video' && localVideo.current) {
        localVideo.current.srcObject = stream
      }
      
      setInCall(true)

      const channel = supabase.channel(`call:${roomId}`)
      channelRef.current = channel // Save ref to send 'leave' signal later

      channel
        .on('broadcast', { event: 'signal' }, ({ payload }) => handleSignal(payload, channel))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'join', senderId: currentUser.id, mode: type } })
          }
        })
    } catch (err) { 
      console.error("Media Error:", err) 
      alert("Could not access Camera/Microphone")
    }
  }

  const startCall = async (type: 'audio' | 'video') => {
    await notifyReceiver(type)
    await joinRoom(type)
  }

  // --- SIGNAL HANDLER ---
  const handleSignal = async (payload: any, channel: any) => {
    const { type, senderId, sdp, candidate } = payload
    if (senderId === currentUser.id) return

    // 1. Handle Remote End Call
    if (type === 'leave') {
      console.log(`User ${senderId} left the call.`)
      // If it's a DM (not group), end the call entirely for me too
      if (!isGroup) {
        cleanupMedia() // Stop my camera
        setInCall(false) // Reset UI
        alert("Call ended by remote user.")
      } else {
        // If Group, just remove that specific peer
        setPeers(prev => prev.filter(p => p.id !== senderId))
        if (peerConnections.current[senderId]) {
          peerConnections.current[senderId].close()
          delete peerConnections.current[senderId]
        }
      }
      return
    }

    // 2. WebRTC Handshakes
    if (!peerConnections.current[senderId]) createPeer(senderId, channel)
    const pc = peerConnections.current[senderId]

    if (type === 'join') {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', sdp: offer, senderId: currentUser.id, targetId: senderId } })
    } else if (type === 'offer' && payload.targetId === currentUser.id) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'answer', sdp: answer, senderId: currentUser.id, targetId: senderId } })
    } else if (type === 'answer' && payload.targetId === currentUser.id) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    } else if (type === 'candidate' && payload.targetId === currentUser.id) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
  }

  const createPeer = (remoteId: number, channel: any) => {
    const pc = new RTCPeerConnection(rtcConfig)
    localStream.current?.getTracks().forEach(track => pc.addTrack(track, localStream.current!))
    
    pc.onicecandidate = e => {
      if (e.candidate) channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'candidate', candidate: e.candidate, senderId: currentUser.id, targetId: remoteId } })
    }
    
    pc.ontrack = e => {
      setPeers(prev => prev.find(p => p.id === remoteId) ? prev : [...prev, { id: remoteId, stream: e.streams[0] }])
    }
    peerConnections.current[remoteId] = pc
  }

  // --- CLEANUP ---
  const cleanupMedia = () => {
    // Stop local tracks (Camera/Mic)
    if (localStream.current) {
      localStream.current.getTracks().forEach(t => t.stop())
      localStream.current = null
    }
    // Close all peer connections
    Object.values(peerConnections.current).forEach(pc => pc.close())
    peerConnections.current = {}
    setPeers([])
  }

  const handleEndCallClick = async () => {
    // 1. Notify others that I am leaving
    if (channelRef.current) {
      await channelRef.current.send({ 
        type: 'broadcast', 
        event: 'signal', 
        payload: { type: 'leave', senderId: currentUser.id } 
      })
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    // 2. Clean up my local resources
    cleanupMedia()
    
    // 3. Update UI
    setInCall(false)
  }

  return (
    <div className="border-b border-gray-800 p-3 bg-gray-900">
      {!inCall ? (
        <div className="flex gap-2 justify-end">
          <button onClick={() => startCall('audio')} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-full text-white text-sm">
            <Phone size={18} />
          </button>
          <button onClick={() => startCall('video')} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-full text-white text-sm">
            <VideoIcon size={18} />
          </button>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex justify-between items-center bg-gray-800 p-2 rounded-lg border border-gray-700 shadow-lg">
            <span className="text-green-400 text-sm font-bold flex items-center gap-2 px-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              {callType === 'audio' ? 'Voice Call' : 'Video Call'} Live
            </span>
            <button 
              onClick={handleEndCallClick} 
              className="bg-red-600 hover:bg-red-500 px-6 py-2 rounded-full text-white flex items-center gap-2 text-sm font-bold shadow-lg transform active:scale-95 transition-all"
            >
              <PhoneOff size={16}/> End Call
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
            {/* My Stream */}
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-gray-700 shadow-inner">
               {callType === 'video' ? (
                 <video ref={localVideo} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
               ) : (
                 <div className="w-full h-full flex items-center justify-center bg-gray-800">
                   <div className="flex flex-col items-center gap-2">
                      <img src={currentUser.avatar} className="w-16 h-16 rounded-full border-2 border-blue-500"/>
                      <span className="text-sm text-gray-300">You</span>
                   </div>
                 </div>
               )}
            </div>

            {/* Remote Streams */}
            {peers.length === 0 && (
                <div className="flex items-center justify-center aspect-video bg-gray-800 rounded-lg border border-gray-700 text-gray-400 text-xs">
                    Waiting for answer...
                </div>
            )}
            
            {peers.map(p => (
              <VideoPlayer key={p.id} stream={p.stream} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const VideoPlayer = ({ stream }: { stream: MediaStream }) => {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return (
    <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-gray-700 shadow-inner">
      <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" />
      <audio ref={el => {if(el) el.srcObject = stream}} autoPlay />
    </div>
  )
}
