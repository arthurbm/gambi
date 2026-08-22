import { cva, type VariantProps } from "class-variance-authority";
import { useMemo } from "react";

import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      className={cn("flex flex-col gap-4", className)}
      data-slot="field-set"
      {...props}
    />
  );
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return (
    <legend
      className={cn("mb-2.5 font-medium text-sm", className)}
      data-slot="field-legend"
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex w-full flex-col gap-5", className)}
      data-slot="field-group"
      {...props}
    />
  );
}

const fieldVariants = cva(
  "group/field flex w-full gap-2 data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        horizontal: "flex-row items-center",
        responsive:
          "@md:flex-row flex-col @md:items-center *:w-full @md:*:w-auto",
        vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
      },
    },
    defaultVariants: { orientation: "vertical" },
  }
);

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: shadcn Field is a composable layout wrapper, not a form fieldset.
    <div
      className={cn(fieldVariants({ orientation }), className)}
      data-orientation={orientation}
      data-slot="field"
      role="group"
      {...props}
    />
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-1 flex-col gap-0.5", className)}
      data-slot="field-content"
      {...props}
    />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      className={cn("flex w-fit gap-2 leading-snug", className)}
      data-slot="field-label"
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex w-fit items-center gap-2 text-xs", className)}
      data-slot="field-label"
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-muted-foreground text-xs leading-normal", className)}
      data-slot="field-description"
      {...props}
    />
  );
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("relative -my-2 h-5 text-xs", className)}
      data-slot="field-separator"
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children ? (
        <span className="relative mx-auto block w-fit bg-background px-2">
          {children}
        </span>
      ) : null}
    </div>
  );
}

function FieldError({
  children,
  className,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }
    const unique = [
      ...new Map(errors?.map((error) => [error?.message, error])).values(),
    ];
    if (unique.length === 1) {
      return unique[0]?.message;
    }
    return unique.length > 1 ? (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {unique.map(
          (error) =>
            error?.message && <li key={error.message}>{error.message}</li>
        )}
      </ul>
    ) : null;
  }, [children, errors]);
  return content ? (
    <div
      className={cn("text-destructive text-xs", className)}
      data-slot="field-error"
      role="alert"
      {...props}
    >
      {content}
    </div>
  ) : null;
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
};
