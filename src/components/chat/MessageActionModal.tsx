import React, { useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Typography } from '@/components/ui/Typography';
import { Icon } from '@/components/ui/Icon';
import { Spacing, BorderRadius, Shadows } from '@/constants/spacing';
import type { ClientMessage } from '@/context/chatTypes';

export interface MessageActionModalProps {
  visible: boolean;
  message: ClientMessage | null;
  currentUserId: string;
  onClose: () => void;
  onStartEdit: (message: ClientMessage) => void;
  onConfirmDelete: (messageId: string) => Promise<void>;
  onRetrySend?: (tempId: string) => Promise<void>;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Message actions bottom-sheet modal.
 * Enforces sender-only editing, 24-hour edit windows, and confirmed soft deletion.
 */
export function MessageActionModal({
  visible,
  message,
  currentUserId,
  onClose,
  onStartEdit,
  onConfirmDelete,
  onRetrySend,
}: MessageActionModalProps) {
  const { colors, isDark } = useAppTheme();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!message) return null;

  const isAuthor = message.senderId === currentUserId;
  const isDeleted = Boolean(message.isDeleted);
  const isSending = message.localStatus === 'sending';
  const isPending = message.localStatus === 'pending';
  const isFailed = message.localStatus === 'failed';
  const isUncertain = message.localStatus === 'uncertain';

  const createdAtMs = message.createdAt ? new Date(message.createdAt).getTime() : 0;
  const isWithin24Hours = Date.now() - createdAtMs <= TWENTY_FOUR_HOURS_MS;

  const canEdit = isAuthor && !isDeleted && !isSending && !isPending && isWithin24Hours && message.type === 'TEXT';
  const canDelete = isAuthor && !isDeleted && !isSending && !isPending;
  const canRetry = isAuthor && (isFailed || isUncertain || isPending);

  const handleClose = () => {
    setIsConfirmingDelete(false);
    setActionError(null);
    onClose();
  };

  const handleEditPress = () => {
    onStartEdit(message);
    handleClose();
  };

  const handleRetryPress = () => {
    if (onRetrySend && (message.tempId || message.id)) {
      onRetrySend(message.tempId || message.id);
    }
    handleClose();
  };

  const handleDeleteExecute = async () => {
    setIsDeleting(true);
    setActionError(null);
    try {
      await onConfirmDelete(message.id);
      handleClose();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to delete message');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.sheetCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
                Shadows.card,
              ]}
            >
              {/* Delete Confirmation Step */}
              {isConfirmingDelete ? (
                <View style={styles.confirmDeleteContainer}>
                  <Typography variant="subtitle" align="center" style={styles.confirmTitle}>
                    Delete Message?
                  </Typography>

                  <Typography
                    variant="body"
                    align="center"
                    color={colors.textSecondary}
                    style={styles.confirmBody}
                  >
                    This message will be removed for everyone in this conversation.
                  </Typography>

                  {Boolean(actionError) && (
                    <Typography
                      variant="caption"
                      color={colors.error}
                      align="center"
                      style={styles.errorText}
                    >
                      {actionError}
                    </Typography>
                  )}

                  <View style={styles.confirmButtonRow}>
                    <TouchableOpacity
                      onPress={() => setIsConfirmingDelete(false)}
                      disabled={isDeleting}
                      style={[
                        styles.modalButton,
                        styles.cancelButton,
                        { borderColor: colors.border },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel deletion"
                    >
                      <Typography variant="bodyMedium" color={colors.textPrimary}>
                        Cancel
                      </Typography>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleDeleteExecute}
                      disabled={isDeleting}
                      style={[
                        styles.modalButton,
                        styles.deleteButton,
                        { backgroundColor: colors.error },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Confirm delete message"
                    >
                      {isDeleting ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Typography variant="bodyMedium" color="#FFFFFF" style={styles.deleteButtonText}>
                          Delete
                        </Typography>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* Primary Actions List */
                <View style={styles.actionsList}>
                  {/* Message Snippet Header */}
                  <View style={styles.snippetHeader}>
                    <Typography
                      variant="caption"
                      color={colors.textMuted}
                      numberOfLines={2}
                      style={styles.snippetText}
                    >
                      "{message.content}"
                    </Typography>
                  </View>

                  {/* Retry Option for Failed Send */}
                  {canRetry && (
                    <TouchableOpacity
                      onPress={handleRetryPress}
                      style={[styles.actionRow, { borderBottomColor: colors.border }]}
                      accessibilityRole="button"
                      accessibilityLabel="Retry sending message"
                    >
                      <Icon name="refresh" size={18} color={colors.accent} style={styles.actionIcon} />
                      <Typography variant="bodyMedium" color={colors.accent}>
                        Retry Sending
                      </Typography>
                    </TouchableOpacity>
                  )}

                  {/* Edit Option (Author only, <=24h) */}
                  {canEdit && (
                    <TouchableOpacity
                      onPress={handleEditPress}
                      style={[styles.actionRow, { borderBottomColor: colors.border }]}
                      accessibilityRole="button"
                      accessibilityLabel="Edit message"
                    >
                      <Icon name="edit" size={18} color={colors.textPrimary} style={styles.actionIcon} />
                      <Typography variant="bodyMedium" color={colors.textPrimary}>
                        Edit Message
                      </Typography>
                    </TouchableOpacity>
                  )}

                  {/* Delete Option (Author only) */}
                  {canDelete && (
                    <TouchableOpacity
                      onPress={() => setIsConfirmingDelete(true)}
                      style={[styles.actionRow, { borderBottomColor: colors.border }]}
                      accessibilityRole="button"
                      accessibilityLabel="Delete message"
                    >
                      <Icon name="trash" size={18} color={colors.error} style={styles.actionIcon} />
                      <Typography variant="bodyMedium" color={colors.error}>
                        Delete Message
                      </Typography>
                    </TouchableOpacity>
                  )}

                  {/* Close / Dismiss */}
                  <TouchableOpacity
                    onPress={handleClose}
                    style={styles.cancelRow}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                  >
                    <Typography variant="bodyMedium" color={colors.textSecondary} align="center">
                      Cancel
                    </Typography>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: Spacing.base,
  },
  sheetCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  snippetHeader: {
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.xs,
  },
  snippetText: {
    fontStyle: 'italic',
    lineHeight: 18,
  },
  actionsList: {
    width: '100%',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionIcon: {
    marginRight: Spacing.md,
  },
  cancelRow: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  confirmTitle: {
    marginBottom: Spacing.sm,
  },
  confirmBody: {
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  errorText: {
    marginBottom: Spacing.md,
  },
  confirmButtonRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    height: 46,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  deleteButton: {
    elevation: 2,
  },
  deleteButtonText: {
    fontWeight: '700',
  },
});

