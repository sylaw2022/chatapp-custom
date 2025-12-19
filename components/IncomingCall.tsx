'use client'
import { useEffect, useRef } from 'react'
import { Phone, PhoneOff, Video } from 'lucide-react'

interface IncomingCallProps {
  caller: { id: number; username: string; avatar: string };
  callType: 'audio' | 'video';
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCall({ caller, callType, onAccept, onReject }: IncomingCallProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    // Play ringtone on mount
    // You can replace this URL with a local file '/ringtone.mp3' in your public folder
    const audio = new Audio('https://upload.wikimedia.org/wikipedia/commons/e/e5/Tetris_theme.ogg');
    audio.loop = true;
    audio.play().catch(e => console.log("Audio autoplay blocked:", e));
    audioRef.current = audio;

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = ''; // Release audio resource
        audioRef.current.load(); // Reset audio element
        audioRef.current = null;
      }
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-gray-900 border border-gray-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center w-80">
        
        {/* Pulsing Avatar */}
        <div className="relative mb-6">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping"></span>
          <img 
            src={caller.avatar || 'https://via.placeholder.com/100'} 
            className="relative w-24 h-24 rounded-full border-4 border-gray-800 object-cover"
          />
        </div>

        <h3 className="text-xl font-bold text-white mb-1">{caller.username}</h3>
        <p className="text-gray-400 mb-8 flex items-center gap-2">
          {callType === 'video' ? <Video size={16}/> : <Phone size={16}/>} 
          Incoming {callType} call...
        </p>

        <div className="flex gap-8">
          {/* Decline */}
          <button 
            onClick={onReject}
            className="flex flex-col items-center gap-2 group"
          >
            <div className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center text-white group-hover:bg-red-500 transition-colors shadow-lg">
              <PhoneOff size={24} />
            </div>
            <span className="text-xs text-gray-400">Decline</span>
          </button>

          {/* Accept */}
          <button 
            onClick={onAccept}
            className="flex flex-col items-center gap-2 group"
          >
            <div className="w-14 h-14 rounded-full bg-green-600 flex items-center justify-center text-white group-hover:bg-green-500 transition-colors shadow-lg animate-bounce">
              <Phone size={24} />
            </div>
            <span className="text-xs text-gray-400">Accept</span>
          </button>
        </div>
      </div>
    </div>
  )
}
