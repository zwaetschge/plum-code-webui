import { Children, isValidElement, type ReactNode } from 'react';
import { useIsDesktopLayout } from '@/hooks/useMediaQuery';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';

// Keep the provider-generated option lists, including disabled entries and groups,
// while giving runtime menus the same keyboard and positioning behavior as other menus.
function renderOptions(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (
      !isValidElement<{ value?: string; disabled?: boolean; label?: string; children?: ReactNode }>(
        child
      )
    )
      return null;
    const { value = '', disabled, label, children: content } = child.props;
    if (child.type === 'optgroup')
      return (
        <SelectGroup>
          <SelectLabel>{label}</SelectLabel>
          {renderOptions(content)}
        </SelectGroup>
      );
    if (child.type !== 'option') return null;
    return (
      <SelectItem value={value || '__empty_selection__'} disabled={disabled}>
        {content}
      </SelectItem>
    );
  });
}

export function RuntimeSelect({
  id,
  value,
  onValueChange,
  disabled,
  children,
  'aria-label': label,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  'aria-label': string;
}) {
  const desktop = useIsDesktopLayout();
  return (
    <Select
      value={value || '__empty_selection__'}
      onValueChange={(next) => onValueChange(next === '__empty_selection__' ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} className="session-runtime-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        side={desktop ? 'right' : 'bottom'}
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className="navigation-popup runtime-popup"
        aria-label={label}
      >
        <div className="px-2 py-1.5 text-sm font-semibold">{label}</div>
        {renderOptions(children)}
      </SelectContent>
    </Select>
  );
}
