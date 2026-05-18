import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../components/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { User, Users, Plus, X, Heart, ShieldAlert, LogOut, Save, Activity, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { dataService } from '../services/dataService';
import { toast } from 'sonner';
import { testAiIntegration } from '../lib/aiTest';
import { testConnection } from '../lib/firebaseTest';

function splitPreferenceList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export const Profile = () => {
  const { profile, logout, refreshProfile } = useContext(AuthContext);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<{ai?: any, firebase?: any, error?: string} | null>(null);

  useEffect(() => {
    if (profile && !editing) {
      setFormData(profile);
    }
  }, [profile, editing]);

  if (!profile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const runDiagnostics = async () => {
    setTesting(true);
    setTestResults(null);
    try {
      const ai = await testAiIntegration();
      const firebase = await testConnection();
      setTestResults({ ai, firebase });
      if (ai.success) {
        toast.success('AI Integration Verified!');
      } else {
        toast.error('AI Integration Failed');
      }
    } catch (e) {
      setTestResults({ error: 'Diagnostics failed to run' });
      toast.error('Diagnostics failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!formData) return;
    setSaving(true);
    try {
      await dataService.saveUserProfile(formData);
      await refreshProfile();
      setEditing(false);
      toast.success('Preferences updated!');
    } catch (e) {
      toast.error('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const addFamilyMember = () => {
    if (!formData) return;
    setFormData({
      ...formData,
      familyMembers: [...formData.familyMembers, { name: '', role: '', preferences: [], allergies: [] }]
    });
  };

  const removeFamilyMember = (index: number) => {
    if (!formData) return;
    const newMembers = [...formData.familyMembers];
    newMembers.splice(index, 1);
    setFormData({ ...formData, familyMembers: newMembers });
  };

  const updateFamilyMember = (index: number, field: string, value: any) => {
    if (!formData) return;
    const newMembers = [...formData.familyMembers];
    newMembers[index] = { ...newMembers[index], [field]: value };
    setFormData({ ...formData, familyMembers: newMembers });
  };

  return (
    <div className="p-6 pb-24 space-y-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary">Family Kitchen</h1>
          <p className="text-muted-foreground italic">Personalize your household experience</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout} className="rounded-xl border-border bg-background/50">
          <LogOut className="h-4 w-4 mr-2" /> Sign Out
        </Button>
      </div>

      <Card className="rounded-[1.75rem] border border-border/50 shadow-sm bg-card overflow-hidden">
        <CardHeader className="bg-muted/60 pb-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" /> User Profile
              </CardTitle>
              <CardDescription>{profile.email}</CardDescription>
            </div>
            {!editing ? (
              <Button
                onClick={() => {
                  setFormData(profile);
                  setEditing(true);
                }}
                variant="secondary"
                className="rounded-xl bg-background shadow-sm border border-border"
              >
                Edit
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={saving} className="rounded-xl bg-primary hover:bg-primary/90">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Diaries & Restrictions</Label>
              <Input 
                disabled={!editing}
                placeholder="e.g. Vegan, Keto, Nut-free" 
                value={formData?.globalPreferences.dietaryRestrictions.join(', ')}
                onChange={(e) => setFormData({...formData!, globalPreferences: {...formData!.globalPreferences, dietaryRestrictions: splitPreferenceList(e.target.value)}})}
                className="rounded-xl border-border focus-visible:ring-primary bg-background/60"
              />
            </div>
            <div className="space-y-2">
              <Label>Favorite Cuisines</Label>
              <Input 
                disabled={!editing}
                placeholder="e.g. Italian, Mexican, Thai" 
                value={formData?.globalPreferences.cuisines.join(', ')}
                onChange={(e) => setFormData({...formData!, globalPreferences: {...formData!.globalPreferences, cuisines: splitPreferenceList(e.target.value)}})}
                className="rounded-xl border-border focus-visible:ring-primary bg-background/60"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Family Members
          </h2>
          {editing && (
            <Button size="sm" variant="ghost" onClick={addFamilyMember} className="text-primary hover:text-primary/90 hover:bg-muted">
              <Plus className="h-4 w-4 mr-1" /> Add Member
            </Button>
          )}
        </div>

        <div className="grid gap-4">
          {(editing ? formData?.familyMembers : profile.familyMembers).map((member, i) => (
            <Card key={i} className="rounded-3xl border border-border/50 bg-background/50 backdrop-blur-sm group">
              <CardContent className="p-5 relative">
                {editing && (
                  <button 
                    onClick={() => removeFamilyMember(i)}
                    className="absolute -top-2 -right-2 bg-background rounded-full p-1 shadow-md border border-border text-red-500 hover:scale-110 transition-transform"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="font-label text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">Name</Label>
                    <Input 
                      disabled={!editing}
                      value={member.name}
                      onChange={(e) => updateFamilyMember(i, 'name', e.target.value)}
                      className="border-none bg-transparent p-0 h-auto focus-visible:ring-0 text-lg font-bold"
                      placeholder="Name"
                    />
                  </div>
                  <div className="space-y-1 text-right">
                    <Label className="font-label text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold">Role</Label>
                    <Input 
                      disabled={!editing}
                      value={member.role}
                      onChange={(e) => updateFamilyMember(i, 'role', e.target.value)}
                      className="border-none bg-transparent p-0 h-auto focus-visible:ring-0 text-right italic"
                      placeholder="Role (e.g. Spouse)"
                    />
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-2 gap-4">
                  <div>
                    <span className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold mb-2">
                       <Heart className="h-3 w-3 fill-pink-500/10 text-pink-500" /> Prefers
                    </span>
                    <Input 
                      disabled={!editing}
                      value={member.preferences.join(', ')}
                      onChange={(e) => updateFamilyMember(i, 'preferences', splitPreferenceList(e.target.value))}
                      className="text-xs border-none bg-muted/60 rounded-xl px-3"
                      placeholder="e.g. Pasta, Fruit"
                    />
                  </div>
                  <div>
                    <span className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-semibold mb-2">
                       <ShieldAlert className="h-3 w-3 text-muted-foreground" /> Allergies
                    </span>
                    <Input 
                      disabled={!editing}
                      value={member.allergies.join(', ')}
                      onChange={(e) => updateFamilyMember(i, 'allergies', splitPreferenceList(e.target.value))}
                      className="text-xs border-none bg-red-50/50 rounded-xl px-3"
                      placeholder="e.g. Shellfish"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!editing ? profile.familyMembers : formData?.familyMembers).length === 0 && (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-[2rem] text-muted-foreground italic">
              No family members added yet. Add them to personalize plans!
            </div>
          )}
        </div>
      </div>

      <Card className="rounded-[1.75rem] border border-border bg-muted/30">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> System Diagnostics
          </CardTitle>
          <CardDescription>Verify AI and Database connectivity</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button 
              onClick={runDiagnostics} 
              disabled={testing}
              className="rounded-xl"
            >
              {testing ? 'Running Tests...' : 'Run System Check'}
            </Button>
          </div>
          
          {testResults && (
            <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between p-3 bg-card rounded-xl border border-border/50">
                    <span className="font-medium">Gemini AI Service</span>
                    {testResults.ai?.success ? (
                        <span className="flex items-center text-green-600 text-sm font-bold gap-1">
                            <CheckCircle2 className="h-4 w-4" /> Operational
                        </span>
                    ) : (
                        <span className="flex items-center text-red-600 text-sm font-bold gap-1">
                            <XCircle className="h-4 w-4" /> Error: {testResults.ai?.error || 'Unknown'}
                        </span>
                    )}
                </div>
                <div className="flex items-center justify-between p-3 bg-card rounded-xl border border-border/50">
                    <span className="font-medium">Firebase Firestore</span>
                    {testResults.firebase?.skipped ? (
                        <span className="flex items-center text-muted-foreground text-sm font-medium gap-1 text-right max-w-[60%]">
                            <ShieldAlert className="h-4 w-4 shrink-0" />
                            {testResults.firebase?.warning || 'Sign in to verify'}
                        </span>
                    ) : testResults.firebase?.success ? (
                        <span className="flex items-center text-green-600 text-sm font-bold gap-1">
                            <CheckCircle2 className="h-4 w-4" /> Operational
                        </span>
                    ) : (
                        <span className="flex items-center text-red-600 text-sm font-bold gap-1">
                            <XCircle className="h-4 w-4" /> {testResults.firebase?.error || 'Failed'}
                        </span>
                    )}
                </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
