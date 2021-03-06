import * as React from 'react';
import { isfunc } from 'piral-base';
import { PiralError, PiralLoadingIndicator } from './components';
import { ErrorBoundary, ErrorBoundaryOptions } from './ErrorBoundary';
import { useGlobalState, useActions } from '../hooks';
import { defaultRender } from '../utils';
import { AnyComponent, Errors, ComponentConverters, ForeignComponent, PiletApi, BaseComponentProps } from '../types';

let portalIdBase = 123456;

interface PortalRendererProps {
  id: string;
}

const PortalRenderer: React.FC<PortalRendererProps> = ({ id }) => {
  const children = useGlobalState(m => m.portals[id] || []);
  return defaultRender(children);
};

interface ForeignComponentContainerProps<T> {
  $portalId: string;
  $component: ForeignComponent<T>;
  innerProps: T & BaseComponentProps;
}

function createForeignComponentContainer<T>(contextTypes = ['router']) {
  return class ForeignComponentContainer extends React.Component<ForeignComponentContainerProps<T>> {
    private current?: HTMLElement;
    private previous?: HTMLElement;
    static contextTypes = contextTypes.reduce((ct, key) => {
      // tslint:disable-next-line
      ct[key] = () => null;
      return ct;
    }, {});

    componentDidMount() {
      const node = this.current;
      const { $component, innerProps } = this.props;
      const { mount } = $component;

      if (node && isfunc(mount)) {
        mount(node, innerProps, this.context);
      }

      this.previous = node;
    }

    componentDidUpdate() {
      const { current, previous } = this;
      const { $component, innerProps } = this.props;
      const { update } = $component;

      if (current !== previous) {
        this.componentWillUnmount();
        this.componentDidMount();
      } else if (isfunc(update)) {
        update(current, innerProps, this.context);
      }
    }

    componentWillUnmount() {
      const node = this.previous;
      const { $component } = this.props;
      const { unmount } = $component;

      if (node && isfunc(unmount)) {
        unmount(node);
      }

      this.previous = undefined;
    }

    render() {
      const { $portalId } = this.props;

      return (
        <div
          data-portal-id={$portalId}
          ref={node => {
            this.current = node;
          }}
        />
      );
    }
  };
}

function wrapReactComponent<T>(
  Component: React.ComponentType<T & BaseComponentProps>,
  stasisOptions: ErrorBoundaryOptions<T>,
  piral: PiletApi,
): React.ComponentType<T> {
  return (props: T) => (
    <ErrorBoundary {...stasisOptions} renderProps={props}>
      <Component {...props} piral={piral} />
    </ErrorBoundary>
  );
}

function wrapForeignComponent<T>(
  component: ForeignComponent<T & BaseComponentProps>,
  stasisOptions: ErrorBoundaryOptions<T>,
  piral: PiletApi,
): React.ComponentType<T> {
  const Component = createForeignComponentContainer<T>();

  return (props: T) => {
    const { destroyPortal } = useActions();
    const [id] = React.useState(() => (portalIdBase++).toString(26));

    React.useEffect(() => {
      return () => destroyPortal(id);
    }, []);

    return (
      <ErrorBoundary {...stasisOptions} renderProps={props}>
        <PortalRenderer id={id} />
        <Component innerProps={{ ...props, piral }} $portalId={id} $component={component} />
      </ErrorBoundary>
    );
  };
}

function isNotExotic(component: any): component is object {
  return !(component as React.ExoticComponent).$$typeof;
}

function wrapComponent<T>(
  converters: ComponentConverters<T & BaseComponentProps>,
  Component: AnyComponent<T & BaseComponentProps>,
  piral: PiletApi,
  stasisOptions: ErrorBoundaryOptions<T>,
) {
  if (!Component) {
    console.error('The given value is not a valid component.');
    // tslint:disable-next-line:no-null-keyword
    Component = () => null;
  }

  if (typeof Component === 'object' && isNotExotic(Component)) {
    const converter = converters[Component.type];

    if (typeof converter !== 'function') {
      throw new Error(`No converter for component of type "${Component.type}" registered.`);
    }

    const result = converter(Component);
    return wrapForeignComponent<T>(result, stasisOptions, piral);
  }

  return wrapReactComponent<T>(Component, stasisOptions, piral);
}

export function withApi<TProps>(
  converters: ComponentConverters<TProps & BaseComponentProps>,
  Component: AnyComponent<TProps & BaseComponentProps>,
  piral: PiletApi,
  errorType: keyof Errors,
) {
  return wrapComponent<TProps>(converters, Component, piral, {
    onError(error) {
      console.error(piral, error);
    },
    renderChild(child) {
      return <React.Suspense fallback={<PiralLoadingIndicator />}>{child}</React.Suspense>;
    },
    renderError(error, props: any) {
      return <PiralError type={errorType} error={error} {...props} />;
    },
  });
}
