import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { useAppData } from "../store/AppDataContext";
import { colors } from "../theme";

import AuthScreen from "../screens/AuthScreen";
import DashboardScreen from "../screens/DashboardScreen";
import InvoiceListScreen from "../screens/InvoiceListScreen";
import InvoiceFormScreen from "../screens/InvoiceFormScreen";
import InvoicePreviewScreen from "../screens/InvoicePreviewScreen";
import CustomersScreen from "../screens/CustomersScreen";
import ProductsScreen from "../screens/ProductsScreen";
import CompaniesScreen from "../screens/CompaniesScreen";
import PaymentsScreen from "../screens/PaymentsScreen";
import MoreScreen from "../screens/MoreScreen";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTitleStyle: { color: colors.ink, fontWeight: "800" },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

function TabIcon({ label, focused }) {
  return <Text style={{ fontSize: 11, fontWeight: focused ? "800" : "500", color: focused ? colors.accent : colors.inkSoft }}>{label}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.ink, fontWeight: "800" },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarIcon: ({ focused }) => <TabIcon label={iconFor(route.name)} focused={focused} />,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Invoices" component={InvoiceListScreen} options={{ headerShown: false }} />
      <Tab.Screen name="More" component={MoreScreen} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}

function iconFor(name) {
  return { Dashboard: "🏠", Invoices: "🧾", More: "⋯" }[name] || "•";
}

function RootStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="InvoiceForm" component={InvoiceFormScreen} options={{ title: "Invoice" }} />
      <Stack.Screen name="InvoicePreview" component={InvoicePreviewScreen} options={{ title: "Preview" }} />
      <Stack.Screen name="InvoiceList" component={InvoiceListScreen} options={{ title: "Invoice History" }} />
      <Stack.Screen name="Customers" component={CustomersScreen} options={{ title: "Customers" }} />
      <Stack.Screen name="Products" component={ProductsScreen} options={{ title: "Products" }} />
      <Stack.Screen name="Companies" component={CompaniesScreen} options={{ title: "My Companies" }} />
      <Stack.Screen name="Payments" component={PaymentsScreen} options={{ title: "Payments" }} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const { authUser, setAuthUser, loading } = useAppData();

  if (authUser === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {!authUser ? (
        <AuthScreen onAuthed={setAuthUser} />
      ) : loading ? (
        <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={{ color: colors.inkSoft, marginTop: 10 }}>Loading your ledger…</Text>
        </View>
      ) : (
        <RootStack />
      )}
    </NavigationContainer>
  );
}
