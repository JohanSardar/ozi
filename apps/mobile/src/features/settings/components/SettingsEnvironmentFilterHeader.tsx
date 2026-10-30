import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { Platform, Pressable } from "react-native";

import { Menu } from "../../../components/ui/Menu";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { withNativeGlassHeaderItem } from "../../layout/native-glass-header-items";
import { useSettingsEnvironmentFilter } from "../settings-environment-filter";

export function SettingsEnvironmentFilterHeader(props: {
  readonly trailingItems?: readonly NativeStackHeaderItem[];
}) {
  const { availableTargets, selectedIds, selectAll, toggleEnvironment } =
    useSettingsEnvironmentFilter();
  const items = [
    {
      id: "all",
      title: "All connected environments",
      state: selectedIds === null ? ("on" as const) : ("off" as const),
    },
    ...availableTargets.map((entry) => ({
      id: entry.environmentId,
      title: entry.label,
      state:
        selectedIds === null || selectedIds.has(entry.environmentId)
          ? ("on" as const)
          : ("off" as const),
    })),
  ];
  const select = (id: string) => {
    if (id === "all") selectAll();
    else {
      const target = availableTargets.find((entry) => entry.environmentId === id);
      if (target) toggleEnvironment(target.environmentId);
    }
  };
  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={JSON.stringify(items)}
        options={{
          unstable_headerRightItems: () => [
            withNativeGlassHeaderItem({
              type: "menu",
              label: "",
              accessibilityLabel: "Filter settings environments",
              icon: { name: "line.3.horizontal.decrease", type: "sfSymbol" },
              menu: {
                title: "Settings scope",
                items: items.map((item) => ({
                  type: "action" as const,
                  label: item.title,
                  state: item.state,
                  onPress: () => select(item.id),
                })),
              },
            }),
            ...(props.trailingItems ?? []),
          ],
        }}
      />
      {Platform.OS !== "ios" ? (
        <Menu
          title="Settings scope"
          actions={items}
          onPressAction={({ nativeEvent }) => select(nativeEvent.event)}
        >
          <Pressable
            accessibilityLabel="Filter settings environments"
            className="size-11 items-center justify-center"
          >
            <SymbolView
              name="line.3.horizontal.decrease"
              size={22}
              tintColorClassName="accent-icon"
            />
          </Pressable>
        </Menu>
      ) : null}
    </>
  );
}

export const AndroidSettingsEnvironmentFilter = SettingsEnvironmentFilterHeader;
