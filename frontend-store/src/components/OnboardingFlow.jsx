import { useState } from 'react'
import OnboardingPermissions from './OnboardingPermissions'
import OnboardingSource from './OnboardingSource'
import OnboardingGuide from './OnboardingGuide'

// First-run flow: permissions first, then the "how did you hear about us"
// question, then the quick guide. Once the user reaches the end, App.jsx
// stores the one-time flag and unmounts this.
export default function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState('permissions')
  if (step === 'permissions') {
    return <OnboardingPermissions onComplete={() => setStep('source')} />
  }
  if (step === 'source') {
    return <OnboardingSource onComplete={() => setStep('guide')} />
  }
  return <OnboardingGuide onComplete={onComplete} />
}