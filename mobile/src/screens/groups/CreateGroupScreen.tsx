import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch, Modal, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { createGroup } from '../../services/api';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';
import type { Group } from '../../types';

interface WizardForm {
  name: string;
  description: string;
  contributionAmount: string;
  maxMembers: string;
  cycleLength: string;
  frequency: 'weekly' | 'monthly';
  templateId: string | null;
}

interface Template {
  id: string;
  name: string;
  description: string;
  contributionAmount: number;
  maxMembers: number;
  cycleLength: number;
  frequency: 'weekly' | 'monthly';
  icon: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'family',
    name: 'Family Circle',
    description: 'Small group for family savings goals',
    contributionAmount: 500,
    maxMembers: 6,
    cycleLength: 30,
    frequency: 'monthly',
    icon: '👨‍👩‍👧‍👦',
  },
  {
    id: 'friends',
    name: 'Friends Group',
    description: 'Medium group for close friends',
    contributionAmount: 1000,
    maxMembers: 10,
    cycleLength: 30,
    frequency: 'monthly',
    icon: '🎉',
  },
  {
    id: 'community',
    name: 'Community Pool',
    description: 'Larger group for neighborhood savings',
    contributionAmount: 2000,
    maxMembers: 20,
    cycleLength: 30,
    frequency: 'monthly',
    icon: '🏘️',
  },
  {
    id: 'rapid',
    name: 'Quick Start',
    description: 'Fast weekly contributions',
    contributionAmount: 100,
    maxMembers: 4,
    cycleLength: 7,
    frequency: 'weekly',
    icon: '⚡',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Set your own parameters',
    contributionAmount: 0,
    maxMembers: 0,
    cycleLength: 0,
    frequency: 'monthly',
    icon: '⚙️',
  },
];

const STEPS = ['Template', 'Details', 'Settings', 'Preview'];

export function CreateGroupScreen() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [form, setForm] = useState<WizardForm>({
    name: '',
    description: '',
    contributionAmount: '',
    maxMembers: '',
    cycleLength: '',
    frequency: 'monthly',
    templateId: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const validateStep = useCallback((step: number): Record<string, string> => {
    const e: Record<string, string> = {};
    switch (step) {
      case 0:
        if (!form.templateId) e.template = 'Please select a template';
        break;
      case 1:
        if (!form.name.trim()) e.name = 'Group name is required';
        else if (form.name.length < 3) e.name = 'Name must be at least 3 characters';
        break;
      case 2:
        if (!form.contributionAmount || isNaN(Number(form.contributionAmount))) {
          e.contributionAmount = 'Enter a valid amount';
        } else if (Number(form.contributionAmount) <= 0) {
          e.contributionAmount = 'Amount must be greater than 0';
        }
        if (!form.maxMembers || isNaN(Number(form.maxMembers))) {
          e.maxMembers = 'Enter a valid number';
        } else if (Number(form.maxMembers) < 2) {
          e.maxMembers = 'Minimum 2 members';
        } else if (Number(form.maxMembers) > 50) {
          e.maxMembers = 'Maximum 50 members';
        }
        if (!form.cycleLength || isNaN(Number(form.cycleLength))) {
          e.cycleLength = 'Enter cycle length in days';
        } else if (Number(form.cycleLength) < 1) {
          e.cycleLength = 'Minimum 1 day';
        }
        break;
    }
    return e;
  }, [form]);

  const handleNext = () => {
    const e = validateStep(currentStep);
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }
    setErrors({});
    if (currentStep === STEPS.length - 1) {
      setShowPreview(true);
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep === 0) {
      router.back();
    } else {
      setCurrentStep((s) => s - 1);
      setErrors({});
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const group = await createGroup({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        contributionAmount: Number(form.contributionAmount),
        maxMembers: Number(form.maxMembers),
        cycleLength: Number(form.cycleLength),
        frequency: form.frequency,
      });
      setShowPreview(false);
      Alert.alert('Group Created', `"${group.name}" is ready.`, [
        { text: 'View Group', onPress: () => router.replace(`/groups/${group.id}`) },
      ]);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  const selectTemplate = (template: Template) => {
    setForm((f) => ({
      ...f,
      templateId: template.id,
      name: template.id === 'custom' ? f.name : template.name,
      contributionAmount: template.id === 'custom' ? f.contributionAmount : String(template.contributionAmount),
      maxMembers: template.id === 'custom' ? f.maxMembers : String(template.maxMembers),
      cycleLength: template.id === 'custom' ? f.cycleLength : String(template.cycleLength),
      frequency: template.id === 'custom' ? f.frequency : template.frequency,
    }));
    setErrors({});
  };

  const setField = (key: keyof WizardForm) => (val: string) => {
    setForm((f) => ({ ...f, [key]: val }));
    if (errors[key]) {
      setErrors((e) => ({ ...e, [key]: '' }));
    }
  };

  const canProceed = () => {
    if (currentStep === 0) return !!form.templateId;
    if (currentStep === 1) return !!form.name.trim();
    if (currentStep === 2) return !!form.contributionAmount && !!form.maxMembers && !!form.cycleLength;
    return true;
  };

  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {STEPS.map((step, index) => (
        <View key={step} style={styles.stepItem}>
          <View
            style={[
              styles.stepCircle,
              index <= currentStep && styles.stepCircleActive,
              index === currentStep && styles.stepCircleCurrent,
            ]}
          >
            <Text
              style={[
                styles.stepNumber,
                index <= currentStep && styles.stepNumberActive,
              ]}
            >
              {index < currentStep ? '✓' : index + 1}
            </Text>
          </View>
          <Text
            style={[
              styles.stepLabel,
              index <= currentStep && styles.stepLabelActive,
            ]}
            numberOfLines={1}
          >
            {step}
          </Text>
          {index < STEPS.length - 1 && (
            <View
              style={[
                styles.stepLine,
                index < currentStep && styles.stepLineActive,
              ]}
            />
          )}
        </View>
      ))}
    </View>
  );

  const renderTemplateStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Choose a Template</Text>
      <Text style={styles.stepSubtitle}>
        Select a starting point for your savings group
      </Text>
      {errors.template && (
        <Text style={styles.stepError}>{errors.template}</Text>
      )}
      <View style={styles.templateGrid}>
        {TEMPLATES.map((template) => (
          <Card
            key={template.id}
            style={[
              styles.templateCard,
              form.templateId === template.id && styles.templateCardSelected,
            ]}
          >
            <TouchableOpacity
              style={styles.templateTouch}
              onPress={() => selectTemplate(template)}
              accessibilityRole="button"
              accessibilityLabel={`Select ${template.name} template`}
            >
              <Text style={styles.templateIcon}>{template.icon}</Text>
              <Text style={styles.templateName}>{template.name}</Text>
              <Text style={styles.templateDesc}>{template.description}</Text>
              {template.id !== 'custom' && (
                <View style={styles.templateDetails}>
                  <Text style={styles.templateDetail}>
                    {template.contributionAmount} XLM • {template.maxMembers} members
                  </Text>
                  <Text style={styles.templateDetail}>
                    {template.cycleLength} days • {template.frequency}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </Card>
        ))}
      </View>
    </View>
  );

  const renderDetailsStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Group Details</Text>
      <Text style={styles.stepSubtitle}>
        Give your group a name and description
      </Text>
      <Card style={styles.formCard}>
        <Input
          label="Group Name *"
          placeholder="e.g. Family Savings Circle"
          value={form.name}
          onChangeText={setField('name')}
          error={errors.name}
          autoCapitalize="words"
        />
        <Input
          label="Description"
          placeholder="What is this group for?"
          value={form.description}
          onChangeText={setField('description')}
          multiline
          numberOfLines={3}
        />
      </Card>
    </View>
  );

  const renderSettingsStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Contribution Settings</Text>
      <Text style={styles.stepSubtitle}>
        Configure how members will contribute
      </Text>
      <Card style={styles.formCard}>
        <Input
          label="Contribution Amount (XLM) *"
          placeholder="e.g. 100"
          value={form.contributionAmount}
          onChangeText={setField('contributionAmount')}
          keyboardType="decimal-pad"
          error={errors.contributionAmount}
        />
        <Input
          label="Max Members *"
          placeholder="e.g. 10"
          value={form.maxMembers}
          onChangeText={setField('maxMembers')}
          keyboardType="number-pad"
          error={errors.maxMembers}
        />
        <Input
          label="Cycle Length (days) *"
          placeholder="e.g. 30"
          value={form.cycleLength}
          onChangeText={setField('cycleLength')}
          keyboardType="number-pad"
          error={errors.cycleLength}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Monthly frequency</Text>
          <Switch
            value={form.frequency === 'monthly'}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, frequency: v ? 'monthly' : 'weekly' }))
            }
            trackColor={{ true: Colors.primary }}
            accessibilityLabel="Toggle frequency between weekly and monthly"
          />
        </View>
        <Text style={styles.freqHint}>
          Currently: {form.frequency === 'monthly' ? 'Monthly' : 'Weekly'}
        </Text>
      </Card>
    </View>
  );

  const renderPreviewStep = () => {
    const amount = Number(form.contributionAmount) || 0;
    const members = Number(form.maxMembers) || 0;
    const cycleDays = Number(form.cycleLength) || 0;
    const totalCyclePayout = amount * members;

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Preview</Text>
        <Text style={styles.stepSubtitle}>
          Review your group configuration
        </Text>
        <Card style={styles.previewCard}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewGroupName}>{form.name}</Text>
            {form.description && (
              <Text style={styles.previewDescription}>{form.description}</Text>
            )}
          </View>
          <View style={styles.previewStats}>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatLabel}>Contribution</Text>
              <Text style={styles.previewStatValue}>
                {amount.toLocaleString()} XLM
              </Text>
            </View>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatLabel}>Max Members</Text>
              <Text style={styles.previewStatValue}>{members}</Text>
            </View>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatLabel}>Cycle Length</Text>
              <Text style={styles.previewStatValue}>{cycleDays} days</Text>
            </View>
            <View style={styles.previewStat}>
              <Text style={styles.previewStatLabel}>Frequency</Text>
              <Text style={styles.previewStatValue}>
                {form.frequency === 'monthly' ? 'Monthly' : 'Weekly'}
              </Text>
            </View>
          </View>
          <View style={styles.previewDivider} />
          <View style={styles.previewTotal}>
            <Text style={styles.previewTotalLabel}>Per Cycle Payout</Text>
            <Text style={styles.previewTotalValue}>
              {totalCyclePayout.toLocaleString()} XLM
            </Text>
          </View>
        </Card>
      </View>
    );
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return renderTemplateStep();
      case 1:
        return renderDetailsStep();
      case 2:
        return renderSettingsStep();
      case 3:
        return renderPreviewStep();
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Button
          title="Back"
          variant="ghost"
          size="sm"
          onPress={handleBack}
        />
        <Text style={styles.headerTitle}>Create Group</Text>
        <View style={styles.headerSpacer} />
      </View>

      {renderStepIndicator()}

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderCurrentStep()}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={currentStep === STEPS.length - 1 ? 'Create Group' : 'Continue'}
          onPress={currentStep === STEPS.length - 1 ? handleCreate : handleNext}
          loading={loading}
          size="lg"
          disabled={!canProceed()}
          style={styles.continueBtn}
        />
      </View>

      <Modal
        visible={showPreview}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPreview(false)}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Preview Group</Text>
            <Button
              title="Edit"
              variant="ghost"
              size="sm"
              onPress={() => setShowPreview(false)}
            />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {renderPreviewStep()}
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button
              title="Confirm & Create"
              onPress={handleCreate}
              loading={loading}
              size="lg"
              style={styles.confirmBtn}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface[50] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerTitle: { ...Typography.h3, color: Colors.surface[900] },
  headerSpacer: { width: 60 },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  stepItem: { flex: 1, alignItems: 'center', position: 'relative' },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: { backgroundColor: Colors.primaryLight },
  stepCircleCurrent: { backgroundColor: Colors.primary },
  stepNumber: { ...Typography.label, color: Colors.surface[500] },
  stepNumberActive: { color: Colors.white, fontWeight: '700' },
  stepLabel: { ...Typography.caption, color: Colors.surface[400], marginTop: 4 },
  stepLabelActive: { color: Colors.surface[700] },
  stepLine: {
    position: 'absolute',
    top: 16,
    left: '50%',
    width: '100%',
    height: 2,
    backgroundColor: Colors.surface[200],
  },
  stepLineActive: { backgroundColor: Colors.primary },
  scroll: { padding: Spacing.lg, paddingBottom: 100 },
  stepContent: { flex: 1 },
  stepTitle: { ...Typography.h2, color: Colors.surface[900], marginBottom: Spacing.xs },
  stepSubtitle: { ...Typography.body, color: Colors.surface[500], marginBottom: Spacing.lg },
  stepError: { ...Typography.caption, color: Colors.error, marginBottom: Spacing.md },
  templateGrid: { gap: Spacing.md },
  templateCard: { padding: Spacing.md },
  templateCardSelected: { borderColor: Colors.primary, borderWidth: 2 },
  templateTouch: { gap: Spacing.xs },
  templateIcon: { fontSize: 32, marginBottom: Spacing.xs },
  templateName: { ...Typography.h3, color: Colors.surface[900] },
  templateDesc: { ...Typography.body, color: Colors.surface[500] },
  templateDetails: { marginTop: Spacing.sm, gap: 2 },
  templateDetail: { ...Typography.caption, color: Colors.surface[400] },
  formCard: { gap: Spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { ...Typography.body, color: Colors.surface[700] },
  freqHint: { ...Typography.caption, color: Colors.surface[400] },
  previewCard: { gap: Spacing.lg },
  previewHeader: { gap: Spacing.xs },
  previewGroupName: { ...Typography.h2, color: Colors.surface[900] },
  previewDescription: { ...Typography.body, color: Colors.surface[600] },
  previewStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  previewStat: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surface[50],
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  previewStatLabel: { ...Typography.caption, color: Colors.surface[500] },
  previewStatValue: { ...Typography.h3, color: Colors.surface[900] },
  previewDivider: { height: 1, backgroundColor: Colors.surface[200] },
  previewTotal: { alignItems: 'center', gap: Spacing.xs },
  previewTotalLabel: { ...Typography.body, color: Colors.surface[500] },
  previewTotalValue: { ...Typography.h2, color: Colors.primary },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.surface[100],
  },
  continueBtn: { width: '100%' },
  modalSafe: { flex: 1, backgroundColor: Colors.surface[50] },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface[100],
  },
  modalTitle: { ...Typography.h2, color: Colors.surface[900] },
  modalContent: { flex: 1, padding: Spacing.lg },
  modalFooter: {
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.surface[100],
  },
  confirmBtn: { width: '100%' },
});