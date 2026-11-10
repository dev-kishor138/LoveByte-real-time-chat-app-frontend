import React, { useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spacing, BorderRadius, Shadows } from '@/constants/spacing';
import { validatePartnerEmail } from '@/utils/validation';
import { useAuth } from '@/context/AuthContext';

export interface StartConversationModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (recipientEmail: string) => Promise<void>;
}

export function StartConversationModal({
  visible,
  onClose,
  onSubmit,
}: StartConversationModalProps) {
  const { colors, isDark } = useAppTheme();
  const { user } = useAuth();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    if (isSubmitting) return;
    setEmail('');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    const validationError = validatePartnerEmail(email, user?.email);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit(email.trim().toLowerCase());
      setEmail('');
      onClose();
    } catch (err: any) {
      const serverMessage = err?.message || 'Failed to start conversation. Please try again.';
      setError(serverMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleClose}
          style={styles.dismissOverlay}
        />

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.border,
            },
            isDark ? Shadows.none : Shadows.medium,
          ]}
        >
          {/* Header */}
          <Typography variant="title" style={styles.title}>
            Start Conversation
          </Typography>

          <Typography
            variant="body"
            color={colors.textSecondary}
            style={styles.subtitle}
          >
            Enter your partner's registered @gmail.com address to connect.
          </Typography>

          {/* Email Input */}
          <Input
            label="Partner's Gmail"
            placeholder="partner@gmail.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (error) setError(null);
            }}
            error={error || undefined}
            editable={!isSubmitting}
            containerStyle={styles.inputContainer}
          />

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <Button
              title="Cancel"
              variant="outline"
              size="md"
              onPress={handleClose}
              disabled={isSubmitting}
              style={styles.button}
            />

            <Button
              title="Connect"
              variant="primary"
              size="md"
              onPress={handleSubmit}
              loading={isSubmitting}
              style={styles.button}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  dismissOverlay: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.xl,
  },
  title: {
    fontSize: 22,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  inputContainer: {
    marginBottom: Spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.md,
  },
  button: {
    minWidth: 100,
  },
});

