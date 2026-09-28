import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { colors } from "../../theme";

export function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={visible ? "Hide password" : "Show password"}
    >
      <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textMuted} />
    </Pressable>
  );
}
