import { useState } from 'react'
import OnboardingPermissions from './OnboardingPermissions'
import OnboardingGuide from './OnboardingGuide'

// First-run flow: permissions first, then the quick guide. Once the user
// reaches the end, App.jsx stores the one-time flag and unmounts this.
export default function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState('permissions')
  return step === 'permissions'
    ? <OnboardingPermissions onComplete={() => setStep('guide')} />
    : <OnboardingGuide onComplete={onComplete} />
}