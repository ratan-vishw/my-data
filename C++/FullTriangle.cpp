#include<iostream>
using namespace std;
int main(){
  cout<<"Enter Number: ";
  int n;
  cin>>n;
  for (int i = 0; i<=n; i++){
    //numbre
    for (int j = i; j>=0; j--){
      cout<<j;
    }
    cout<<endl;
  }

   for (int i = 0; i<=n; i++){
    //numbre
    for (int j = 0; j<=i; j++){
      cout<<j;
    }
    cout<<endl;
  }

  for (int i = n; i>=0; i--){
    //numbre
    for (int j = 0; j<=i; j++){
      cout<<j;
    }
    cout<<endl;
  }

  for (int i = n; i>=0; i--){
    //numbre
    for (int j = i; j>=0; j--){
      cout<<j;
    }
    cout<<endl;
  }

  for (int i = n; i>=0; i--){
    //numbre
    for (int j = i; j>=0; j--){
      cout<<j*i<<" ";
    }
    cout<<endl;
  }
  return 0;
}