import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../hooks/useTheme';
import { fetchProfile } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Spacing, Typography, BorderRadius } from '../../constants/theme';
import type { UserProfile } from '../../types';

export function ProfileScreen() {
  const router = useRouter();
  const { session, logout } = useAuthStore();
  const { colors, isDark, toggleTheme } = useTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    if (session?.address) {
      fetchProfile(session.address)
        .then(setProfile)
        .catch(() => {});
    }
  }, [session?.address]);

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to disconnect your wallet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const shortAddress = session?.address
    ? `${session.address.slice(0, 6)}...${session.address.slice(-4)}`
    : '';

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.surface[50] },
    scroll: { padding: Spacing.lg, gap: Spacing.lg },
    avatarSection: { alignItems: 'center', gap: Spacing.sm },
    avatar: { width: 80, height: 80, borderRadius: 40 },
    avatarPlaceholder: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: { ...Typography.h1, color: colors.white },
    cameraIcon: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      backgroundColor: colors.surface[600],
      borderRadius: 12,
      padding: 4,
    },
    displayName: { ...Typography.h3, color: colors.surface[900] },
    address: { ...Typography.bodySmall, color: colors.surface[500], fontFamily: 'monospace' },
    network: {
      ...Typography.caption,
      color: colors.primary,
      backgroundColor: isDark ? colors.primaryLight : '#ede9fe',
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
    },
    statsCard: { gap: Spacing.md },
    sectionTitle: { ...Typography.h3, color: colors.surface[800] },
    statsGrid: { flexDirection: 'row', gap: Spacing.sm },
    settingsCard: { overflow: 'hidden' },
    logoutBtn: { width: '100%' },
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Avatar + address */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handlePickAvatar} accessibilityLabel="Change profile picture">
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {session?.address?.slice(0, 1) ?? 'A'}
                </Text>
              </View>
            )}
            <View style={styles.cameraIcon}>
              <Ionicons name="camera" size={14} color={colors.white} />
            </View>
          </TouchableOpacity>
          <Text style={styles.displayName}>
            {profile?.displayName ?? shortAddress}
          </Text>
          <Text style={styles.address}>{shortAddress}</Text>
          <Text style={styles.network}>{session?.network ?? 'testnet'}</Text>
        </View>

        {/* Stats */}
        {profile?.stats && (
          <Card style={styles.statsCard}>
            <Text style={styles.sectionTitle}>Activity</Text>
            <View style={styles.statsGrid}>
              <StatBox label="Active Groups" value={profile.stats.activeGroups} />
              <StatBox label="Completed" value={profile.stats.completedGroups} />
              <StatBox label="Contributions" value={profile.stats.totalContributions} />
              <StatBox label="Success Rate" value={`${profile.stats.successRate}%`} />
            </View>
          </Card>
        )}

        {/* Settings */}
        <Card style={styles.settingsCard} padding="none">
          <TouchableOpacity style={rowStyles.row} onPress={toggleTheme} accessibilityRole="button">
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.surface[500]} />
            <Text style={rowStyles.label}>Dark Mode</Text>
            <View style={rowStyles.right}>
              <Ionicons name={isDark ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={isDark ? colors.primary : colors.surface[400]} />
            </View>
          </TouchableOpacity>
          <SettingsRow icon="notifications-outline" label="Notifications" onPress={() => {}} />
          <SettingsRow icon="shield-outline" label="Security & Biometrics" onPress={() => router.push('/biometric-settings')} />
          <SettingsRow icon="globe-outline" label="Network" value={session?.network} onPress={() => {}} />
          <SettingsRow icon="document-text-outline" label="Transaction History" onPress={() => {}} />
        </Card>

        <Button
          title="Sign Out"
          onPress={handleLogout}
          variant="danger"
          size="lg"
          style={styles.logoutBtn}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  const { colors } = useTheme();
  return (
    <View style={statStyles.box}>
      <Text style={[statStyles.value, { color: colors.primary }]}>{value}</Text>
      <Text style={[statStyles.label, { color: colors.surface[500] }]}>{label}</Text>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={[rowStyles.row, { borderBottomColor: colors.surface[200] }]} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon as any} size={20} color={colors.surface[500]} />
      <Text style={[rowStyles.label, { color: colors.surface[800] }]}>{label}</Text>
      <View style={rowStyles.right}>
        {value && <Text style={[rowStyles.value, { color: colors.surface[400] }]}>{value}</Text>}
        <Ionicons name="chevron-forward" size={16} color={colors.surface[400]} />
      </View>
    </TouchableOpacity>
  );
}

const statStyles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', gap: 2 },
  value: { ...Typography.h3 },
  label: { ...Typography.caption, textAlign: 'center' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.md,
  },
  label: { ...Typography.body, flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  value: { ...Typography.bodySmall },
});
